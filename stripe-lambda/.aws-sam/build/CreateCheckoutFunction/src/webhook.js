'use strict';

const Stripe = require('stripe');
const { PACKAGE_MAP } = require('./packages');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Lazy-init Firebase Admin (only if FIREBASE_SERVICE_ACCOUNT env var is set)
let _db = null;
function getDb() {
  if (_db) return _db;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) return null;
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
    });
  }
  _db = admin.firestore();
  return _db;
}

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const session = stripeEvent.data.object;
  if (session.payment_status !== 'paid') {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const { packageId, chips, game, userId, clientSessionId } = session.metadata || {};
  const pkg = PACKAGE_MAP[packageId];

  if (!pkg) {
    console.error('Unknown packageId in metadata:', packageId);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const chipCount = parseInt(chips, 10);

  console.log(JSON.stringify({
    event:           'chip_purchase',
    stripeSessionId: session.id,
    packageId,
    chips:           chipCount,
    game,
    userId:          userId || 'guest',
    clientSessionId,
    amountTotal:     session.amount_total,
    customerEmail:   session.customer_details?.email || null,
    timestamp:       new Date().toISOString(),
  }));

  // Credit chips directly to Firestore if userId is present
  if (userId) {
    const db = getDb();
    if (db) {
      try {
        const userRef = db.collection('users').doc(userId);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(userRef);
          const current = snap.exists ? (snap.data().balance || 0) : 0;
          tx.set(userRef, {
            balance:        current + chipCount,
            totalPurchased: (snap.exists ? (snap.data().totalPurchased || 0) : 0) + session.amount_total,
          }, { merge: true });
        });
        console.log(`Credited ${chipCount} chips to user ${userId}`);
      } catch (err) {
        console.error('Firestore credit failed:', err.message);
      }
    } else {
      console.warn('FIREBASE_SERVICE_ACCOUNT not set — chips not auto-credited to Firestore');
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true, chips: chipCount }),
  };
};
