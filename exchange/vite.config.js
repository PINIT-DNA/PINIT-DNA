import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  appType: 'spa',
  plugins: [
    react(),
    {
      name: 'exchange-spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const path = String(req.url || '').split('?')[0];
          if (/^\/p\/[^/.]+\/?$/.test(path)) {
            req.url = '/index.html';
          }
          next();
        });
      },
    },
  ],
  server: {
    // Hub client uses 3000 — keep Exchange on 5174 to avoid collision
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      }
    }
  }
});
