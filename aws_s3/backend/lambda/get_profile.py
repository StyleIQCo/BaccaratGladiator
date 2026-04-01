import json
import os
from decimal import Decimal

import boto3

TABLE_NAME = os.environ['TABLE_NAME']
ddb = boto3.resource('dynamodb')
table = ddb.Table(TABLE_NAME)


def _to_int(v, default=0):
    try:
        if v is None:
            return default
        return int(float(v))
    except Exception:
        return default


def _json_safe(v):
    if isinstance(v, Decimal):
        if v % 1 == 0:
            return int(v)
        return float(v)
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
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(_json_safe(body))
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

    username = (
        claims.get('preferred_username')
        or claims.get('cognito:username')
        or claims.get('username')
        or 'Player'
    )
    email = (claims.get('email') or '').strip().lower()

    item = table.get_item(Key={'userSub': user_sub}).get('Item') or {}

    score = _to_int(item.get('score'), 1000)
    top_score = _to_int(item.get('topScore'), score)
    hand_count = _to_int(item.get('handCount'), 0)

    return _resp(200, {
        'username': item.get('username') or username,
        'email': item.get('email') or email,
        'score': score,
        'topScore': top_score,
        'handCount': hand_count,
        'wins': _to_int(item.get('wins'), 0),
        'ties': _to_int(item.get('ties'), 0),
        'naturals': _to_int(item.get('naturals'), 0),
        'updatedAt': item.get('updatedAt', ''),
    })
