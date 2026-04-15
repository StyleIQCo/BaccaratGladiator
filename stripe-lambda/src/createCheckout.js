'use strict';

const Stripe = require('stripe');
const { PACKAGE_MAP } = require('./packages');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const ORIGIN = process.env.ALLOWED_ORIGIN;

const CORS = {
  'Access-Control-Allow-Origin':  ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

exports.handler = async (event) => {
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

  const { packageId, game, sessionId } = body;

  // Validate package
  const pkg = PACKAGE_MAP[packageId];
  if (!pkg) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Invalid package', validPackages: Object.keys(PACKAGE_MAP) }),
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

  const gameSlug = game === 'blackjack' ? 'bj' : '';
  const gameUrl  = gameSlug ? `${ORIGIN}/${gameSlug}` : ORIGIN;

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
              images:      [`${ORIGIN}/baccarat-gladiator-logo.svg`],
            },
          },
          quantity: 1,
        },
      ],
      // Pass metadata so the webhook knows what to credit
      metadata: {
        packageId,
        chips:     String(pkg.chips),
        game,
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
