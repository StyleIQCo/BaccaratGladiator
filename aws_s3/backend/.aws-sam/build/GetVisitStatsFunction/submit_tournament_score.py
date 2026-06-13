"""
POST /tournament/score
─────────────────────
Submits a finished monthly-tournament run for the authenticated user.

v2 anti-cheat: the client submits the per-hand bet HISTORY, not a final
balance. The server replays the deterministic shoe (seeded from the
tournament ID) using the submitted bets and computes the trusted final
balance via `baccarat_engine.replay_tournament`. Any mismatch — invalid
bet, bet exceeding balance, malformed entry, or fewer than the required
number of hands — is rejected.

Body:
    {
        "tournament":   "YYYY-MM",
        "bets":         [ { banker, player, tie, dragon7, panda8, pair_p, pair_b }, ... ],
        "submittedAt":  "2026-06-12T19:42:11Z"   (optional, server stamps)
    }

The `bets` array length must equal the tournament hand cap (80). One
row per (tournamentId, userSub); re-submissions only overwrite on a
new personal best (strictly higher final balance).
"""

import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal

import boto3

from baccarat_engine import (
    hash_string_to_seed,
    replay_tournament,
)

TABLE_NAME = os.environ['TOURNAMENT_TABLE']
ddb = boto3.resource('dynamodb')
table = ddb.Table(TABLE_NAME)

TOURNAMENT_HAND_CAP   = 80
TOURNAMENT_START_BAL  = 10_000
TOURNAMENT_MAX_CIRCLE = 5_000     # per circle (banker, dragon7, etc.) per hand
TOURNAMENT_ID_RE      = re.compile(r'^\d{4}-\d{2}$')


def _resp(code, body):
    return {
        'statusCode': code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps(body, default=_json_default),
    }


def _json_default(v):
    if isinstance(v, Decimal):
        return int(v) if v % 1 == 0 else float(v)
    raise TypeError(f'unserializable: {type(v)}')


def _to_int(v, default=0):
    try:
        if v is None:
            return default
        return int(float(v))
    except Exception:
        return default


def _tournament_window(tournament_id: str):
    """Return (start, end) of a tournament month in UTC."""
    y, m = (int(x) for x in tournament_id.split('-'))
    start = datetime(y, m, 1, 0, 0, 0, tzinfo=timezone.utc)
    if m == 12:
        end = datetime(y + 1, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    else:
        end = datetime(y, m + 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    return start, end


def handler(event, context):
    claims = (
        event.get('requestContext', {})
        .get('authorizer', {})
        .get('jwt', {})
        .get('claims', {})
    )
    user_sub = claims.get('sub')
    if not user_sub:
        return _resp(401, {'error': 'Unauthorized'})

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        return _resp(400, {'error': 'Invalid JSON body'})

    # ── 1. Tournament ID + window ───────────────────────────────
    tournament = str(body.get('tournament', '')).strip()
    if not TOURNAMENT_ID_RE.match(tournament):
        return _resp(400, {'error': 'Invalid tournament ID — expected YYYY-MM'})

    start, end = _tournament_window(tournament)
    now = datetime.now(timezone.utc)
    if now < start or now >= end:
        return _resp(400, {
            'error':       'Tournament window is not currently open',
            'tournament':  tournament,
            'opens':       start.isoformat(),
            'closes':      end.isoformat(),
        })

    # ── 2. Bet history shape ────────────────────────────────────
    bets = body.get('bets')
    if not isinstance(bets, list):
        return _resp(400, {'error': 'bets must be a list of per-hand decisions'})
    if len(bets) != TOURNAMENT_HAND_CAP:
        return _resp(400, {
            'error':         f'Expected exactly {TOURNAMENT_HAND_CAP} hands of bets',
            'submitted':     len(bets),
            'expected':      TOURNAMENT_HAND_CAP,
        })

    # ── 3. Server-side replay — this is the trusted score ──────
    seed = hash_string_to_seed(f'bg-tournament-{tournament}')
    replay = replay_tournament(
        seed=seed,
        bet_history=bets,
        starting_balance=TOURNAMENT_START_BAL,
        max_bet_per_circle=TOURNAMENT_MAX_CIRCLE,
    )

    if not replay.get('valid'):
        return _resp(400, {
            'error':           'Replay rejected — invalid bet sequence',
            'detail':          replay.get('error'),
            'invalidAtHand':   replay.get('invalid_at_hand'),
            'serverBalance':   replay.get('final_balance'),
            'handsValidated':  replay.get('hands_played'),
        })

    final_balance = int(replay['final_balance'])
    hands_played  = int(replay['hands_played'])
    dragon7       = int(replay['dragon7'])
    panda8        = int(replay['panda8'])

    username = (
        body.get('username')
        or claims.get('preferred_username')
        or claims.get('cognito:username')
        or claims.get('username')
        or 'Player'
    ).strip()[:40]
    email = (body.get('email') or claims.get('email') or '').strip().lower()[:120]

    # ── 4. Personal-best overwrite (or first submission) ───────
    existing = table.get_item(
        Key={'tournamentId': tournament, 'userSub': user_sub}
    ).get('Item') or {}

    prior_best = _to_int(existing.get('finalBalance'), -1)
    is_new_best = final_balance > prior_best

    submitted_at = datetime.now(timezone.utc).isoformat()

    if is_new_best or not existing:
        item = {
            'tournamentId':  tournament,
            'userSub':       user_sub,
            'username':      username,
            'email':         email,
            'finalBalance':  Decimal(final_balance),
            'handsPlayed':   Decimal(hands_played),
            'dragon7':       Decimal(dragon7),
            'panda8':        Decimal(panda8),
            'attempts':      Decimal(_to_int(existing.get('attempts'), 0) + 1),
            'firstAt':       existing.get('firstAt') or submitted_at,
            'updatedAt':     submitted_at,
            'replayVersion': 'v2',
        }
        table.put_item(Item=item)
    else:
        table.update_item(
            Key={'tournamentId': tournament, 'userSub': user_sub},
            UpdateExpression='SET attempts = if_not_exists(attempts, :z) + :one, lastAttemptAt = :now',
            ExpressionAttributeValues={
                ':z':   Decimal(0),
                ':one': Decimal(1),
                ':now': submitted_at,
            },
        )

    # ── 5. Live-rank lookup for the response ───────────────────
    try:
        from boto3.dynamodb.conditions import Key
        better = table.query(
            IndexName='TournamentScoreIndex',
            KeyConditionExpression=Key('tournamentId').eq(tournament) & Key('finalBalance').gt(Decimal(final_balance)),
            Select='COUNT',
        ).get('Count', 0)
        rank = better + 1
    except Exception:
        rank = None

    return _resp(200, {
        'ok':            True,
        'tournament':    tournament,
        'finalBalance':  final_balance,
        'handsPlayed':   hands_played,
        'dragon7':       dragon7,
        'panda8':        panda8,
        'isNewBest':     is_new_best,
        'priorBest':     prior_best if prior_best >= 0 else None,
        'rank':          rank,
        'submittedAt':   submitted_at,
        'replayVersion': 'v2',
    })
