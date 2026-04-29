'use strict';

const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };
}

exports.handler = async (event) => {
  const CORS = getCors(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const sessionId = (event.queryStringParameters || {}).session_id;
  if (!sessionId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing session_id' }) };
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return { statusCode: 402, headers: CORS, body: JSON.stringify({ error: 'Payment not completed' }) };
    }

    const sessionType = (session.metadata || {}).type;
    if (sessionType !== 'book' && sessionType !== 'bundle') {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Not a book purchase' }) };
    }

    const downloadUrl = process.env.BOOK_PDF_URL;
    if (!downloadUrl) {
      console.error('BOOK_PDF_URL env var not set');
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Download not configured' }) };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, downloadUrl }),
    };
  } catch (err) {
    console.error('Stripe verify error:', err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Verification failed' }),
    };
  }
};
