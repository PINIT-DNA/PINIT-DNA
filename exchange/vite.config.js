import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);

/** The certificate Exchange shows is the Hub's own component, not a copy. */
const SHARED_CERTIFICATE = fileURLToPath(new URL('../client/src/shared/certificate/PinitCertificateDocument.tsx', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

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
  resolve: {
    alias: {
      '@pinit/certificate': SHARED_CERTIFICATE,
      // The shared certificate lives in client/, so Node looks for qrcode there.
      // Exchange installs it in its own node_modules, which that walk never reaches.
      qrcode: require.resolve('qrcode'),
    },
    // The shared file is outside this app; dedupe keeps a single React copy.
    dedupe: ['react', 'react-dom', 'qrcode'],
  },
  server: {
    // Hub client uses 3002 — keep Exchange on 5174 to avoid collision
    port: 5174,
    // Dev server must be allowed to read the shared certificate outside exchange/
    fs: { allow: [REPO_ROOT] },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      }
    }
  }
});
