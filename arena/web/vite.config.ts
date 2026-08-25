import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// base '/arena/' so every asset URL is prefixed — the whole app lives under the
// rollback-isolated path. Dev proxies the WebSocket to a local gateway.
export default defineConfig({
  base: '/arena/',
  plugins: [react()],
  // Scan only real entries — keeps the dep-scanner out of any dist-* build
  // output sitting in the web root (their bundles confuse it).
  optimizeDeps: { entries: ['index.html', 'race-demo.html'] },
  resolve: {
    alias: { '@bg/shared': resolve(__dirname, '../packages/shared/src/index.ts') },
    // The odyssey campaign module (repo-root odyssey/src) sits outside this
    // web root; its bare react/framer-motion imports would otherwise resolve
    // upward from odyssey/ and miss arena's hoisted node_modules.
    dedupe: ['react', 'react-dom', 'framer-motion'],
  },
  server: {
    proxy: {
      '/arena/ws': { target: 'http://localhost:8080', ws: true, changeOrigin: true },
      '/arena/config': { target: 'http://localhost:5173', bypass: () => undefined }, // served from public/
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // Standalone Daily Jumbotron Race page → /arena/race-demo.html
        'race-demo': resolve(__dirname, 'race-demo.html'),
      },
    },
  },
});
