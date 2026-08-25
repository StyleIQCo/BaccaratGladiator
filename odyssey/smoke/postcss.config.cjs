// Tailwind is required: OdysseyCampaignMap is styled with Tailwind utility
// classes, and this harness doubles as the proof that the documented host
// contract (content globs covering odyssey/src) actually produces styles.
const path = require('node:path');
const ARENA_NM = path.resolve(__dirname, '../../arena/node_modules');

module.exports = {
  plugins: [
    require(path.join(ARENA_NM, 'tailwindcss'))({
      config: path.join(__dirname, 'tailwind.config.cjs'),
    }),
    require(path.join(ARENA_NM, 'autoprefixer')),
  ],
};
