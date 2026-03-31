import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3

TABLE_NAME = os.environ['TABLE_NAME']
ddb = boto3.resource('dynamodb')
table = ddb.Table(TABLE_NAME)


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
        body = {}

    username = (body.get('username') or claims.get('preferred_username') or claims.get('cognito:username') or 'Player').strip()[:40]
    email = (body.get('email') or claims.get('email') or '').strip().lower()[:120]

    score = _to_int(body.get('balance'), 0)
    rounds = _to_int(body.get('rounds'), 0)
    wins = _to_int(body.get('wins'), 0)
    ties = _to_int(body.get('ties'), 0)
    naturals = _to_int(body.get('naturals'), 0)

    existing = table.get_item(Key={'userSub': user_sub}).get('Item') or {}
    prior_top = _to_int(existing.get('topScore'), 0)
    top_score = max(prior_top, score)

    now = datetime.now(timezone.utc).isoformat()

    item = {
        'userSub': user_sub,
        'scope': 'GLOBAL',
        'username': username,
        'email': email,
        'topScore': Decimal(top_score),
        'lastScore': Decimal(score),
        'rounds': Decimal(rounds),
        'wins': Decimal(wins),
        'ties': Decimal(ties),
        'naturals': Decimal(naturals),
        'updatedAt': now,
    }

    table.put_item(Item=item)

    return _resp(200, {
        'ok': True,
        'username': username,
        'scoreSubmitted': score,
        'topScore': top_score,
        'updatedAt': now
    })
