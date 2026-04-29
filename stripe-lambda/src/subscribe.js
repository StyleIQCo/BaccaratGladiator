'use strict';

const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({});

const ALLOWED_ORIGINS = [
  'https://baccaratgladiator.com',
  'https://www.baccaratgladiator.com',
];

function getCors(event) {
  const origin = (event.headers || {})['origin'] || (event.headers || {})['Origin'] || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  const CORS = getCors(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const email = (body.email || '').trim().toLowerCase();
  const source = (body.source || 'unknown').slice(0, 64);

  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  const TABLE = process.env.SUBSCRIBERS_TABLE;
  if (!TABLE) {
    console.error('SUBSCRIBERS_TABLE env var not set');
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Not configured' }) };
  }

  try {
    await ddb.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        email:      { S: email },
        source:     { S: source },
        subscribedAt: { S: new Date().toISOString() },
      },
      ConditionExpression: 'attribute_not_exists(email)',
    }));
    console.log(JSON.stringify({ event: 'subscribe', email, source }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Already subscribed — idempotent, return OK
    } else {
      console.error('DynamoDB error:', err.message);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to save' }) };
    }
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ ok: true }),
  };
};
