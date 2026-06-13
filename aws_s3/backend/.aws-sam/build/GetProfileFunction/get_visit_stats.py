import json
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ['VISITS_TABLE']
ddb = boto3.resource('dynamodb')
table = ddb.Table(TABLE_NAME)


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
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(_json_safe(body))
    }


def _day_stats(day):
    # Each item under a day is one unique visitor for that day.
    unique = 0
    total = 0
    times = []
    kwargs = {
        'IndexName': 'ByDay',
        'KeyConditionExpression': Key('day').eq(day),
    }
    while True:
        resp = table.query(**kwargs)
        for row in resp.get('Items', []):
            unique += 1
            total += int(row.get('count', 0))
            times.append(row.get('lastSeen', ''))
        lek = resp.get('LastEvaluatedKey')
        if not lek:
            break
        kwargs['ExclusiveStartKey'] = lek
    times.sort()
    return {
        'day': day,
        'uniqueVisitors': unique,
        'totalVisits': total,
        # Most recent 200 visit timestamps for that day.
        'visitTimes': times[-200:],
    }


def handler(event, context):
    qsp = event.get('queryStringParameters') or {}

    try:
        days = int(qsp.get('days', '1'))
    except Exception:
        days = 1
    days = max(1, min(31, days))

    base = qsp.get('day')
    if base:
        try:
            anchor = datetime.strptime(base, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        except ValueError:
            return _resp(400, {'error': 'day must be YYYY-MM-DD'})
    else:
        anchor = datetime.now(timezone.utc)

    per_day = []
    for i in range(days):
        d = (anchor - timedelta(days=i)).strftime('%Y-%m-%d')
        per_day.append(_day_stats(d))

    return _resp(200, {
        # uniqueVisitors here is the sum of daily uniques; a visitor active
        # on multiple days is counted once per day, not once overall.
        'uniqueVisitors': sum(d['uniqueVisitors'] for d in per_day),
        'totalVisits': sum(d['totalVisits'] for d in per_day),
        'days': per_day,
    })
