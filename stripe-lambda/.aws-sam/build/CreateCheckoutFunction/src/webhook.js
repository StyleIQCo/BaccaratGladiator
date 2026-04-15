'use strict';

const Stripe = require('stripe');
const { PACKAGE_MAP } = require('./packages');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.body;

  // Verify the webhook came from Stripe
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Only handle successful checkouts
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const session = stripeEvent.data.object;

  // Verify payment was actually paid
  if (session.payment_status !== 'paid') {
    console.log('Session not paid, ignoring:', session.id);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const { packageId, chips, game, clientSessionId } = session.metadata || {};
  const pkg = PACKAGE_MAP[packageId];

  if (!pkg) {
    console.error('Unknown packageId in metadata:', packageId);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  // Log the successful purchase — this is the verified server-side record
  console.log(JSON.stringify({
    event:           'chip_purchase',
    stripeSessionId: session.id,
    packageId,
    chips:           parseInt(chips, 10),
    game,
    clientSessionId,
    amountTotal:     session.amount_total,
    currency:        session.currency,
    customerEmail:   session.customer_details?.email || null,
    timestamp:       new Date().toISOString(),
  }));

  // The frontend credits chips on the success_url redirect using the
  // chips= query param. The webhook serves as the verified audit log.
  // If you add a database later, persist the purchase here.

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true, chips: parseInt(chips, 10) }),
  };
};
