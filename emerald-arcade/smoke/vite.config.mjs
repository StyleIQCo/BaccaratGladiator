// Vite config for the Emerald Arcade smoke harness. Like the odyssey
// module, emerald-arcade has no toolchain of its own — react/framer-motion/
// vite all come from arena/node_modules (the workspace hoists deps there,
// NOT arena/web/node_modules).
// esbuild.jsx MUST be 'automatic': with no tsconfig near the sources,
// esbuild falls back to the classic transform and the page dies with
// "React is not defined".
// No Tailwind here on purpose — the hub is inline-styled so hosts don't
// inherit a content-glob requirement.
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
      { find: 'framer-motion', replacement: resolve(ARENA_NM, 'framer-motion') },
    ],
  },
  build: { outDir: 'dist' },
};
