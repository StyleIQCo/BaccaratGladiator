import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// base '/arena/' so every asset URL is prefixed — the whole app lives under the
// rollback-isolated path. Dev proxies the WebSocket to a local gateway.
export default defineConfig({
  base: '/arena/',
  plugins: [react()],
  resolve: { alias: { '@bg/shared': resolve(__dirname, '../packages/shared/src/index.ts') } },
  server: {
    proxy: {
      '/arena/ws': { target: 'http://localhost:8080', ws: true, changeOrigin: true },
      '/arena/config': { target: 'http://localhost:5173', bypass: () => undefined }, // served from public/
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
