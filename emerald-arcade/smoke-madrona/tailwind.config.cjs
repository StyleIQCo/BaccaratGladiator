// Mirrors the documented host requirement: content globs MUST include
// emerald-arcade/src/**/*.{ts,tsx} or the labyrinth chrome renders unstyled.
const path = require('node:path');

module.exports = {
  content: [
    path.join(__dirname, '../src/**/*.{ts,tsx}'),
    path.join(__dirname, 'main.tsx'),
  ],
  theme: { extend: {} },
  plugins: [],
};
