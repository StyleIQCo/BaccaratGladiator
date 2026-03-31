import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3

TABLE_NAME = os.environ['TABLE_NAME']
ddb = boto3.resource('dynamodb')
table = ddb.Table(TABLE_NAME)

RANKS = {'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'}
SUITS = {'♠', '♥', '♦', '♣'}
VALID_MODES = {'standard', 'ez', 'tiger'}
BET_KEYS = ('banker', 'player', 'tie', 'dragon7', 'panda8', 'bigTiger', 'smallTiger', 'tigerTie')
MAX_BET = 1_000_000


def _resp(code, body):
    return {
        'statusCode': code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(body)
    }


def _to_int(v, default=0):
    try:
        if v is None:
            return default
        return int(float(v))
    except Exception:
        return default


def _card_val(card):
    rank = card['rank']
    if rank == 'A':
        return 1
    if rank in {'10', 'J', 'Q', 'K'}:
        return 0
    return int(rank)


def _total(cards):
    return sum(_card_val(c) for c in cards) % 10


def _banker_draws(b_total, p_third):
    if b_total <= 2:
        return True
    if b_total == 7:
        return False
    if p_third is None:
        return b_total <= 5

    p_val = _card_val(p_third)
    if b_total == 3:
        return p_val != 8
    if b_total == 4:
        return 2 <= p_val <= 7
    if b_total == 5:
        return 4 <= p_val <= 7
    if b_total == 6:
        return p_val in {6, 7}
    return False


def _normalize_cards(raw_cards):
    if not isinstance(raw_cards, list):
        raise ValueError('Cards must be arrays')
    if len(raw_cards) not in {2, 3}:
        raise ValueError('Cards must contain exactly 2 or 3 cards')

    out = []
    for c in raw_cards:
        if not isinstance(c, dict):
            raise ValueError('Card must be an object')
        rank = str(c.get('rank', '')).strip().upper()
        suit = str(c.get('suit', '')).strip()
        if rank not in RANKS or suit not in SUITS:
            raise ValueError('Invalid card rank/suit')
        out.append({'rank': rank, 'suit': suit})
    return out


def _normalize_bets(raw_bets, mode):
    if not isinstance(raw_bets, dict):
        raise ValueError('bets must be an object')

    bets = {}
    for k in BET_KEYS:
        v = _to_int(raw_bets.get(k, 0), 0)
        if v < 0:
            raise ValueError(f'{k} cannot be negative')
        if v > MAX_BET:
            raise ValueError(f'{k} exceeds max bet')
        bets[k] = v

    if bets['banker'] > 0 and bets['player'] > 0:
        raise ValueError('Cannot bet banker and player simultaneously')

    if mode != 'ez' and (bets['dragon7'] > 0 or bets['panda8'] > 0):
        raise ValueError('Dragon/Panda bets only allowed in EZ mode')
    if mode != 'tiger' and (bets['bigTiger'] > 0 or bets['smallTiger'] > 0 or bets['tigerTie'] > 0):
        raise ValueError('Tiger bets only allowed in Tiger mode')

    total_bet = sum(bets.values())
    if total_bet <= 0:
        raise ValueError('At least one bet is required')
    return bets, total_bet


def _validate_and_score(mode, player_cards, banker_cards, bets):
    p2 = _total(player_cards[:2])
    b2 = _total(banker_cards[:2])

    p_has_third = len(player_cards) == 3
    b_has_third = len(banker_cards) == 3

    natural = (p2 >= 8) or (b2 >= 8)
    if natural:
        if p_has_third or b_has_third:
            raise ValueError('Natural hand cannot draw third cards')
    else:
        expected_p_third = (p2 <= 5)
        if p_has_third != expected_p_third:
            raise ValueError('Invalid player third-card decision')

        p_third = player_cards[2] if p_has_third else None
        expected_b_third = _banker_draws(b2, p_third)
        if b_has_third != expected_b_third:
            raise ValueError('Invalid banker third-card decision')

    p_total = _total(player_cards)
    b_total = _total(banker_cards)
    if p_total > b_total:
        winner = 'P'
    elif b_total > p_total:
        winner = 'B'
    else:
        winner = 'T'

    is_dragon7 = (mode == 'ez' and winner == 'B' and len(banker_cards) == 3 and b_total == 7)
    is_panda8 = (mode == 'ez' and winner == 'P' and len(player_cards) == 3 and p_total == 8)
    is_small_tiger = (mode == 'tiger' and winner == 'B' and b_total == 6 and len(banker_cards) == 2)
    is_big_tiger = (mode == 'tiger' and winner == 'B' and b_total == 6 and len(banker_cards) == 3)
    is_tiger_tie = (mode == 'tiger' and winner == 'T' and p_total == 6 and b_total == 6)

    total_bet = sum(bets.values())
    payout_return = 0

    # Main bets
    if winner == 'T':
        payout_return += bets['banker'] + bets['player']
        if bets['tie'] > 0:
            payout_return += bets['tie'] * 9
    elif winner == 'B':
        if bets['banker'] > 0:
            if mode == 'standard':
                payout_return += bets['banker'] + int(bets['banker'] * 0.95)
            elif mode == 'ez':
                payout_return += bets['banker'] + (0 if is_dragon7 else bets['banker'])
            else:
                payout_return += bets['banker'] + (int(bets['banker'] * 0.5) if b_total == 6 else bets['banker'])
    else:  # winner == 'P'
        if bets['player'] > 0:
            payout_return += bets['player'] * 2

    # Side bets
    if mode == 'ez':
        if bets['dragon7'] > 0 and is_dragon7:
            payout_return += bets['dragon7'] * 41
        if bets['panda8'] > 0 and is_panda8:
            payout_return += bets['panda8'] * 26
    elif mode == 'tiger':
        if bets['tigerTie'] > 0 and is_tiger_tie:
            payout_return += bets['tigerTie'] * 36
        if bets['smallTiger'] > 0 and is_small_tiger:
            payout_return += bets['smallTiger'] * 23
        if bets['bigTiger'] > 0 and is_big_tiger:
            payout_return += bets['bigTiger'] * 51

    hand_delta = payout_return - total_bet

    winning_cards = banker_cards if winner == 'B' else player_cards if winner == 'P' else []
    is_natural = winner in {'B', 'P'} and len(winning_cards) == 2 and (b_total if winner == 'B' else p_total) in {8, 9}

    return {
        'winner': winner,
        'pTotal': p_total,
        'bTotal': b_total,
        'isDragon7': is_dragon7,
        'isPanda8': is_panda8,
        'isSmallTiger': is_small_tiger,
        'isBigTiger': is_big_tiger,
        'isTigerTie': is_tiger_tie,
        'isNatural': is_natural,
        'handDelta': hand_delta,
        'totalBet': total_bet,
    }


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

    mode = str(body.get('gameMode', 'ez')).strip().lower()
    if mode not in VALID_MODES:
        return _resp(400, {'error': 'Invalid gameMode'})

    seq = _to_int(body.get('seq'), 0)
    if seq <= 0:
        return _resp(400, {'error': 'seq must be a positive integer'})

    try:
        player_cards = _normalize_cards(body.get('playerCards'))
        banker_cards = _normalize_cards(body.get('bankerCards'))
        bets, _ = _normalize_bets(body.get('bets', {}), mode)
        verdict = _validate_and_score(mode, player_cards, banker_cards, bets)
    except ValueError as e:
        return _resp(400, {'error': str(e)})

    existing = table.get_item(Key={'userSub': user_sub}).get('Item') or {}
    prior_score = _to_int(existing.get('score'), 1000)
    prior_top = _to_int(existing.get('topScore'), prior_score)
    prior_hand_count = _to_int(existing.get('handCount'), 0)

    expected_seq = prior_hand_count + 1
    if seq != expected_seq:
        return _resp(409, {
            'error': 'Sequence mismatch',
            'expectedSeq': expected_seq,
            'handCount': prior_hand_count,
            'score': prior_score,
            'topScore': prior_top,
        })

    if verdict['totalBet'] > prior_score:
        return _resp(400, {
            'error': 'Insufficient server balance for submitted bets',
            'score': prior_score,
            'required': verdict['totalBet'],
        })

    username = (body.get('username') or claims.get('preferred_username') or claims.get('cognito:username') or 'Player').strip()[:40]
    email = (body.get('email') or claims.get('email') or '').strip().lower()[:120]

    next_score = prior_score + verdict['handDelta']
    next_top = max(prior_top, next_score)
    next_hand_count = prior_hand_count + 1
    now = datetime.now(timezone.utc).isoformat()

    wins_inc = 1 if verdict['winner'] in {'B', 'P'} else 0
    ties_inc = 1 if verdict['winner'] == 'T' else 0
    naturals_inc = 1 if verdict['isNatural'] else 0

    item = {
        'userSub': user_sub,
        'scope': 'GLOBAL',
        'username': username,
        'email': email,
        'score': Decimal(next_score),
        'topScore': Decimal(next_top),
        'lastScore': Decimal(next_score),
        'handCount': Decimal(next_hand_count),
        'rounds': Decimal(next_hand_count),
        'wins': Decimal(_to_int(existing.get('wins'), 0) + wins_inc),
        'ties': Decimal(_to_int(existing.get('ties'), 0) + ties_inc),
        'naturals': Decimal(_to_int(existing.get('naturals'), 0) + naturals_inc),
        'updatedAt': now,
    }

    table.put_item(Item=item)

    return _resp(200, {
        'ok': True,
        'seq': next_hand_count,
        'score': next_score,
        'topScore': next_top,
        'handDelta': verdict['handDelta'],
        'winner': verdict['winner'],
        'pTotal': verdict['pTotal'],
        'bTotal': verdict['bTotal'],
        'isDragon7': verdict['isDragon7'],
        'isPanda8': verdict['isPanda8'],
        'isSmallTiger': verdict['isSmallTiger'],
        'isBigTiger': verdict['isBigTiger'],
        'isTigerTie': verdict['isTigerTie'],
        'isNatural': verdict['isNatural'],
        'updatedAt': now,
    })
