import hashlib
import json
import os
from datetime import datetime, timezone

import boto3

TABLE_NAME = os.environ['VISITS_TABLE']
# Salt keeps stored visitor ids non-reversible. Counting uniques does not
# require retaining the raw IP, which is personal data under GDPR/CCPA.
SALT = os.environ.get('VISIT_SALT', '')

ddb = boto3.resource('dynamodb')
table = ddb.Table(TABLE_NAME)


def _resp(code, body=None):
    return {
        'statusCode': code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(body or {})
    }


def _source_ip(event):
    # HTTP API (payload v2) puts the client IP here. Honour an upstream
    # X-Forwarded-For if present (CloudFront / proxy), taking the first hop.
    headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    xff = headers.get('x-forwarded-for')
    if xff:
        return xff.split(',')[0].strip()
    try:
        return event['requestContext']['http']['sourceIp']
    except (KeyError, TypeError):
        return ''


def _visitor_id(ip):
    return hashlib.sha256((SALT + ip).encode('utf-8')).hexdigest()[:32]


def handler(event, context):
    ip = _source_ip(event)
    if not ip:
        return _resp(400, {'error': 'no client ip'})

    now = datetime.now(timezone.utc)
    day = now.strftime('%Y-%m-%d')
    ts = now.isoformat()

    body = {}
    try:
        body = json.loads(event.get('body') or '{}') or {}
    except Exception:
        body = {}
    # Keep only a short, bounded path label for "which page" breakdowns.
    path = str(body.get('path', ''))[:128]

    visitor = _visitor_id(ip)

    table.update_item(
        Key={'visitorId': visitor, 'day': day},
        UpdateExpression=(
            'ADD #c :one '
            'SET lastSeen = :ts, lastPath = :p, '
            'firstSeen = if_not_exists(firstSeen, :ts)'
        ),
        ExpressionAttributeNames={'#c': 'count'},
        ExpressionAttributeValues={':one': 1, ':ts': ts, ':p': path},
    )

    return _resp(204)
