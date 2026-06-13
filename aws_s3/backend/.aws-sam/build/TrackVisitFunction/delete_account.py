"""
delete_account.handler
======================
Apple now requires apps that let users create accounts to support full
in-app account deletion (App Store Review Guideline 5.1.1(v), effective
2022-06-30). This handler is the backend half of that requirement —
the frontend invokes it from `baccarat-game.html` after a two-step
confirmation.

Authorization
-------------
Caller must present a valid Cognito JWT (CognitoJwtAuthorizer wires this
up at the API Gateway layer). The user can only delete *their own*
account — we always operate on the `sub` from the verified JWT claims;
the caller cannot pass a target user ID.

What gets deleted
-----------------
1. Leaderboard row keyed by userSub.
2. All tournament-score rows where userSub matches (scan + delete).
3. The Cognito user itself (AdminDeleteUser).

Failure modes
-------------
The three deletes happen sequentially. If a later step fails after an
earlier one succeeded, we return a 500 with `partial: True` so the
client can surface a "data partially deleted — contact support" message.
The user-visible commitment in /responsible-play.html promises completion
within 30 days, so a partial-failure on the rare retry case is still
within policy.
"""
import json
import os

import boto3
from botocore.exceptions import ClientError

LEADERBOARD_TABLE = os.environ['TABLE_NAME']
TOURNAMENT_TABLE = os.environ['TOURNAMENT_TABLE']
USER_POOL_ID = os.environ['USER_POOL_ID']

_ddb = boto3.resource('dynamodb')
_leaderboard = _ddb.Table(LEADERBOARD_TABLE)
_tournaments = _ddb.Table(TOURNAMENT_TABLE)
_cognito = boto3.client('cognito-idp')


def _resp(code, body):
    return {
        'statusCode': code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps(body),
    }


def _delete_leaderboard(user_sub):
    _leaderboard.delete_item(Key={'userSub': user_sub})


def _delete_tournament_rows(user_sub):
    """Scan + delete is acceptable here: account deletion is rare and the
    tournament table is small (one row per (tournament, user) pair).
    PAY_PER_REQUEST billing means a scan-on-delete will not break a budget.
    If the table grows past ~10k rows we should add a GSI on userSub."""
    deleted = 0
    scan_kwargs = {
        'FilterExpression': 'userSub = :sub',
        'ExpressionAttributeValues': {':sub': user_sub},
        'ProjectionExpression': 'tournamentId, userSub',
    }
    while True:
        page = _tournaments.scan(**scan_kwargs)
        for it in page.get('Items', []):
            _tournaments.delete_item(Key={
                'tournamentId': it['tournamentId'],
                'userSub': it['userSub'],
            })
            deleted += 1
        if 'LastEvaluatedKey' not in page:
            return deleted
        scan_kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']


def _delete_cognito_user(username):
    try:
        _cognito.admin_delete_user(
            UserPoolId=USER_POOL_ID,
            Username=username,
        )
    except _cognito.exceptions.UserNotFoundException:
        # User already gone — treat as success.
        pass


def handler(event, context):
    claims = (
        event.get('requestContext', {})
        .get('authorizer', {})
        .get('jwt', {})
        .get('claims', {})
    )
    user_sub = claims.get('sub')
    username = (
        claims.get('cognito:username')
        or claims.get('preferred_username')
        or claims.get('username')
        or user_sub
    )
    if not user_sub:
        return _resp(401, {'error': 'unauthorized'})

    # Step 1 — leaderboard row.
    try:
        _delete_leaderboard(user_sub)
    except ClientError as e:
        return _resp(500, {
            'error': 'leaderboard_delete_failed',
            'detail': str(e),
            'partial': False,
        })

    # Step 2 — tournament rows.
    try:
        tournament_rows_deleted = _delete_tournament_rows(user_sub)
    except ClientError as e:
        return _resp(500, {
            'error': 'tournament_delete_failed',
            'detail': str(e),
            'partial': True,
            'leaderboard_deleted': True,
        })

    # Step 3 — Cognito user (last, so a failure here still leaves no
    # leftover data the user could be linked to via their sub).
    try:
        _delete_cognito_user(username)
    except ClientError as e:
        return _resp(500, {
            'error': 'cognito_delete_failed',
            'detail': str(e),
            'partial': True,
            'leaderboard_deleted': True,
            'tournament_rows_deleted': tournament_rows_deleted,
        })

    return _resp(200, {
        'ok': True,
        'leaderboard_deleted': True,
        'tournament_rows_deleted': tournament_rows_deleted,
        'cognito_deleted': True,
    })
