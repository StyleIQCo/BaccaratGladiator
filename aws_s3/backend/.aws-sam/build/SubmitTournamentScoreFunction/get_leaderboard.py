import json
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ['TABLE_NAME']
ddb = boto3.resource('dynamodb')
table = ddb.Table(TABLE_NAME)


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
    qsp = event.get('queryStringParameters') or {}
    try:
        limit = int(qsp.get('limit', '20'))
    except Exception:
        limit = 20
    limit = max(1, min(100, limit))

    resp = table.query(
        IndexName='GlobalScoreIndex',
        KeyConditionExpression=Key('scope').eq('GLOBAL'),
        ScanIndexForward=False,
        Limit=limit,
    )

    items = resp.get('Items', [])
    out = []
    for row in items:
        out.append({
            'username': row.get('username', 'Player'),
            'topScore': row.get('topScore', 0),
            'rounds': row.get('rounds', 0),
            'wins': row.get('wins', 0),
            'ties': row.get('ties', 0),
            'updatedAt': row.get('updatedAt', ''),
        })

    return _resp(200, {'items': out})
