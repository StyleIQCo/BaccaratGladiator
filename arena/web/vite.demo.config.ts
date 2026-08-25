// Demo-only build: bundles race-demo.html into a single self-contained
// chunk (assets inlined as data URIs) so it can be pasted into any host
// page — used for shareable previews. NOT the production arena build.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-race-demo',
    emptyOutDir: true,
    assetsInlineLimit: 10_000_000, // inline the placeholder WAVs too
    rollupOptions: {
      input: resolve(__dirname, 'race-demo.html'),
      output: { inlineDynamicImports: true },
    },
  },
});
