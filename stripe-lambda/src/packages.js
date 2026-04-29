'use strict';

// Chip packages — single source of truth used by both Lambda functions.
// priceId will be set after you create products in Stripe dashboard.
// For now we define everything here and create prices dynamically.

const PACKAGES = [
  {
    id:       'starter',
    name:     'Starter Pack',
    chips:    2500,
    price:    199,   // cents — $1.99
    bonus:    '',
    popular:  false,
  },
  {
    id:       'popular',
    name:     'Popular Pack',
    chips:    7500,
    price:    499,   // $4.99
    bonus:    '+20%',
    popular:  true,
  },
  {
    id:       'value',
    name:     'Value Pack',
    chips:    17500,
    price:    999,   // $9.99
    bonus:    '+40%',
    popular:  false,
  },
  {
    id:       'best_deal',
    name:     'Best Deal',
    chips:    40000,
    price:    1999,  // $19.99
    bonus:    '+60%',
    popular:  false,
  },
  {
    id:       'high_roller',
    name:     'High Roller',
    chips:    125000,
    price:    4999,  // $49.99
    bonus:    '+100%',
    popular:  false,
  },
];

// Digital book products
const BOOKS = [
  {
    id:       'book_pdf',
    name:     'Road to Nine — Baccarat Gladiator Guide',
    price:    1499, // cents — $14.99
    type:     'book',
    filename: 'Road_to_Nine.pdf',
  },
  {
    id:       'book_bundle',
    name:     'Road to Nine + 50,000 App Chips',
    price:    1999, // cents — $19.99
    type:     'bundle',
    filename: 'Road_to_Nine.pdf',
    chips:    50000,
  },
];

// Map by id for fast lookup
const PACKAGE_MAP = Object.fromEntries(PACKAGES.map(p => [p.id, p]));
const BOOK_MAP    = Object.fromEntries(BOOKS.map(b => [b.id, b]));

module.exports = { PACKAGES, PACKAGE_MAP, BOOKS, BOOK_MAP };
