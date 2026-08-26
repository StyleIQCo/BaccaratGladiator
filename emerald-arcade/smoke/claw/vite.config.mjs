// Vite config for the Emerald City Claw smoke harness. Same contract as
// smoke/vite.config.mjs: emerald-arcade has no toolchain of its own, so
// react/framer-motion/vite/tailwind all come from arena/node_modules (the
// workspace hoists deps there, NOT arena/web/node_modules).
// esbuild.jsx MUST be 'automatic' or the page dies with "React is not
// defined". Tailwind IS wired here (postcss.config.cjs) because the
// EmeraldClawGame wrapper is Tailwind-styled — this harness doubles as
// proof of the documented host contract (content glob over src/).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARENA_NM = resolve(HERE, '../../../arena/node_modules');
const ARCADE_SRC = resolve(HERE, '../../src');

export default {
  base: './',
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: '@arcade', replacement: ARCADE_SRC },
      { find: 'react-dom', replacement: resolve(ARENA_NM, 'react-dom') },
      { find: 'react', replacement: resolve(ARENA_NM, 'react') },
      { find: 'framer-motion', replacement: resolve(ARENA_NM, 'framer-motion') },
    ],
  },
  build: { outDir: 'dist' },
};
