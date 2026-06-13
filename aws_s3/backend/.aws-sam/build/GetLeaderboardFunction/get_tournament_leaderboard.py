"""
GET /tournament/leaderboard?id=YYYY-MM&limit=50
─────────────────────────────────────────────
Public endpoint (no auth). Returns the leaderboard for a single
monthly tournament, sorted by finalBalance descending. Defaults to
the current month if `id` is omitted.

Tied scores: rows with identical finalBalance fall back to handsPlayed
ascending (fewer hands = better) and then to firstAt ascending (earlier
submission wins).
"""

import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ['TOURNAMENT_TABLE']
ddb = boto3.resource('dynamodb')
table = ddb.Table(TABLE_NAME)

TOURNAMENT_ID_RE = re.compile(r'^\d{4}-\d{2}$')


def _json_safe(v):
    if isinstance(v, Decimal):
        return int(v) if v % 1 == 0 else float(v)
    if isinstance(v, dict):
        return {k: _json_safe(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_json_safe(x) for x in v]
    return v


def _resp(code, body):
    return {
        'statusCode': code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps(_json_safe(body)),
    }


def _current_month_id():
    now = datetime.now(timezone.utc)
    return f'{now.year:04d}-{now.month:02d}'


def handler(event, context):
    qsp = event.get('queryStringParameters') or {}
    tournament = (qsp.get('id') or _current_month_id()).strip()
    if not TOURNAMENT_ID_RE.match(tournament):
        return _resp(400, {'error': 'Invalid id — expected YYYY-MM'})

    try:
        limit = int(qsp.get('limit', '50'))
    except Exception:
        limit = 50
    limit = max(1, min(200, limit))

    # Query the GSI sorted by finalBalance desc.
    resp = table.query(
        IndexName='TournamentScoreIndex',
        KeyConditionExpression=Key('tournamentId').eq(tournament),
        ScanIndexForward=False,    # top scores first
        Limit=limit,
    )

    rows = resp.get('Items', [])

    # Tie-break sort: same finalBalance -> fewer hands first, then earliest firstAt
    rows.sort(
        key=lambda r: (
            -int(r.get('finalBalance', 0)),
            int(r.get('handsPlayed', 0)),
            r.get('firstAt', '9999'),
        )
    )

    out = []
    for r in rows:
        out.append({
            'username':     r.get('username', 'Player'),
            'finalBalance': r.get('finalBalance', 0),
            'handsPlayed':  r.get('handsPlayed', 0),
            'dragon7':      r.get('dragon7', 0),
            'panda8':       r.get('panda8', 0),
            'updatedAt':    r.get('updatedAt', ''),
        })

    return _resp(200, {
        'tournament': tournament,
        'count':      len(out),
        'items':      out,
    })
