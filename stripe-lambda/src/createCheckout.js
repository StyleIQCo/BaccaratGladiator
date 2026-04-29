'use strict';

const Stripe = require('stripe');
const { PACKAGE_MAP, BOOK_MAP } = require('./packages');

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
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };
}

exports.handler = async (event) => {
  const CORS = getCors(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { packageId, game, sessionId, userId } = body;

  const BASE_URL = 'https://baccaratgladiator.com';

  // ── Book / bundle purchase ───────────────────────────────────────────────
  const book = BOOK_MAP[packageId];
  if (book) {
    const isBundle = book.type === 'bundle';
    const desc = isBundle
      ? `27 chapters · 17 appendices · Print-ready PDF + ${book.chips.toLocaleString()} app chips`
      : '27 chapters · 17 appendices · Print-ready PDF · Immediate download';
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: book.price,
              product_data: {
                name:        book.name,
                description: desc,
                images:      [`${BASE_URL}/gumroad-cover-final.png`],
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          packageId,
          type:   book.type,
          chips:  isBundle ? String(book.chips) : '0',
          userId: body.userId || '',
        },
        success_url: `${BASE_URL}/guide-download.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${BASE_URL}/book.html?purchase=cancelled`,
      });

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ url: session.url, sessionId: session.id }),
      };
    } catch (err) {
      console.error('Stripe error (book):', err.message);
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'Failed to create checkout session' }),
      };
    }
  }

  // ── Chip purchase ────────────────────────────────────────────────────────
  const pkg = PACKAGE_MAP[packageId];
  if (!pkg) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Invalid package', validPackages: [...Object.keys(PACKAGE_MAP), ...Object.keys(BOOK_MAP)] }),
    };
  }

  // Validate game
  if (!['baccarat', 'blackjack'].includes(game)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Invalid game. Must be "baccarat" or "blackjack"' }),
    };
  }

  const gameSlug  = game === 'blackjack' ? 'bj/' : '';
  const gameUrl   = gameSlug ? `${BASE_URL}/${gameSlug}` : `${BASE_URL}/`;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: pkg.price,
            product_data: {
              name:        `${pkg.name} — ${pkg.chips.toLocaleString()} Chips`,
              description: `${pkg.chips.toLocaleString()} chips for BaccaratGladiator${pkg.bonus ? ` (${pkg.bonus} value)` : ''}`,
              images:      [`${BASE_URL}/baccarat-gladiator-logo.svg`],
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        packageId,
        chips:           String(pkg.chips),
        game,
        userId:          userId || '',
        clientSessionId: sessionId || '',
      },
      success_url: `${gameUrl}?purchase=success&chips=${pkg.chips}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${gameUrl}?purchase=cancelled`,
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ url: session.url, sessionId: session.id }),
    };
  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Failed to create checkout session' }),
    };
  }
};
