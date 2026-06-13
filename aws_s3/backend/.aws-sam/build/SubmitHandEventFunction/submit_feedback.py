import json
import os
import uuid
from datetime import datetime, timezone

import boto3

TABLE_NAME = os.environ['FEEDBACK_TABLE']
TOPIC_ARN = os.environ.get('FEEDBACK_TOPIC_ARN', '')

ddb = boto3.resource('dynamodb')
table = ddb.Table(TABLE_NAME)
sns = boto3.client('sns') if TOPIC_ARN else None

CATEGORY_LABEL = {'bug': 'Bug Report', 'feature': 'Feature', 'general': 'General'}

# Unauthenticated endpoint — guests submit feedback too — so everything that
# lands here is untrusted. Cap field sizes hard so a single report can't bloat
# a row past DynamoDB's 400KB item limit or rack up storage on abuse.
VALID_CATEGORIES = {'bug', 'feature', 'general'}
MAX_MESSAGE = 4000
MAX_FIELD = 512


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
    headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    xff = headers.get('x-forwarded-for')
    if xff:
        return xff.split(',')[0].strip()
    try:
        return event['requestContext']['http']['sourceIp']
    except (KeyError, TypeError):
        return ''


def _clip(val, limit):
    return str(val if val is not None else '')[:limit]


def handler(event, context):
    try:
        body = json.loads(event.get('body') or '{}') or {}
    except Exception:
        return _resp(400, {'error': 'invalid json'})

    category = str(body.get('category', 'general')).lower()
    if category not in VALID_CATEGORIES:
        category = 'general'

    message = _clip(body.get('message', ''), MAX_MESSAGE).strip()
    if not message:
        return _resp(400, {'error': 'message is required'})

    # Auto-captured client context — best effort, every field optional and
    # length-clamped. Stored verbatim for debugging; never trusted/executed.
    ctx = body.get('context') or {}
    if not isinstance(ctx, dict):
        ctx = {}

    now = datetime.now(timezone.utc)
    item = {
        'feedbackId': now.strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8],
        'day': now.strftime('%Y-%m-%d'),
        'createdAt': now.isoformat(),
        'category': category,
        'message': message,
        'userId': _clip(ctx.get('user_id'), MAX_FIELD),
        'userEmail': _clip(ctx.get('user_email'), MAX_FIELD),
        'balance': _clip(ctx.get('current_balance'), 64),
        'tableState': _clip(ctx.get('current_table_state'), 64),
        'venue': _clip(ctx.get('current_venue'), 64),
        'browserInfo': _clip(ctx.get('browser_info'), MAX_FIELD),
        'page': _clip(ctx.get('page'), MAX_FIELD),
        'viewport': _clip(ctx.get('viewport'), 32),
        'appVersion': _clip(ctx.get('app_version'), 64),
        'sourceIp': _clip(_source_ip(event), 64),
    }

    table.put_item(Item=item)
    _notify(item)
    return _resp(201, {'ok': True, 'id': item['feedbackId']})


def _notify(item):
    # Email the submission via SNS. Best effort — a notification failure must
    # never fail the user's submission (the row is already saved above).
    if not sns:
        return
    label = CATEGORY_LABEL.get(item['category'], item['category'])
    who = item['userId'] or 'guest'
    subject = 'BG {}: {}'.format(label, who)[:100]  # SNS subject hard limit
    body = (
        '{}\n\n'
        'From:    {}{}\n'
        'When:    {}\n'
        'Balance: {}\n'
        'Table:   {}\n'
        'Venue:   {}\n'
        'Page:    {}\n'
        'Browser: {}\n'
        'ID:      {}\n'
    ).format(
        item['message'],
        who, ' <{}>'.format(item['userEmail']) if item['userEmail'] else '',
        item['createdAt'], item['balance'], item['tableState'],
        item['venue'], item['page'], item['browserInfo'], item['feedbackId'],
    )
    try:
        sns.publish(TopicArn=TOPIC_ARN, Subject=subject, Message=body)
    except Exception as e:
        print('feedback SNS publish failed:', e)
