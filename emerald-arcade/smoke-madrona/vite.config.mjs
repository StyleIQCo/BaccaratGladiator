// Vite config for the Madrona Wood Labyrinth smoke harness.
// Separate from emerald-arcade/smoke/ (the hub + cherry harness) because
// this one NEEDS Tailwind: the labyrinth wrapper + marble inventory are
// utility-styled, so this harness doubles as proof that the documented
// host contract (content globs covering emerald-arcade/src) produces
// real styles — same role smoke-seaplane plays for the seaplane cabinet.
// Toolchain comes from arena/node_modules (workspace-hoisted, NOT
// arena/web/node_modules). esbuild.jsx MUST be 'automatic': with no
// tsconfig near the sources, esbuild falls back to the classic transform
// and the page dies with "React is not defined".
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARENA_NM = resolve(HERE, '../../arena/node_modules');
const ARCADE_SRC = resolve(HERE, '../src');

export default {
  base: './',
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: '@arcade', replacement: ARCADE_SRC },
      { find: 'react-dom', replacement: resolve(ARENA_NM, 'react-dom') },
      { find: 'react', replacement: resolve(ARENA_NM, 'react') },
      // The wrapper + inventory animate with framer-motion, which lives
      // in arena/node_modules — outside this harness's resolve walk.
      { find: 'framer-motion', replacement: resolve(ARENA_NM, 'framer-motion') },
    ],
  },
  build: { outDir: 'dist' },
};
