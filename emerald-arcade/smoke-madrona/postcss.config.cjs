// Tailwind is required: the labyrinth wrapper + marble inventory are
// utility-styled, so this harness proves the documented host contract
// (content globs covering emerald-arcade/src) produces real styles.
// Toolchain from arena/node_modules.
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
