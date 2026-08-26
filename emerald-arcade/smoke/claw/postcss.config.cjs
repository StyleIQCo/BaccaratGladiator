// Tailwind is required: EmeraldClawGame's control deck / prize card /
// haul screen are Tailwind-styled. Mirrors odyssey/smoke's wiring —
// tailwind + autoprefixer resolved from arena/node_modules.
const path = require('node:path');
const ARENA_NM = path.resolve(__dirname, '../../../arena/node_modules');

module.exports = {
  plugins: [
    require(path.join(ARENA_NM, 'tailwindcss'))({
      config: path.join(__dirname, 'tailwind.config.cjs'),
    }),
    require(path.join(ARENA_NM, 'autoprefixer')),
  ],
};
