import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND_URL = process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000';

/** Suppress noisy `[vite] http proxy error: ECONNREFUSED` when backend is not running */
function silentProxyErrors(): Plugin {
  return {
    name: 'pinit-silent-proxy-errors',
    configureServer(server) {
      const originalError = server.config.logger.error.bind(server.config.logger);
      server.config.logger.error = (msg, options) => {
        const text = typeof msg === 'string' ? msg : String(msg ?? '');
        if (text.includes('http proxy error') || text.includes('ECONNREFUSED')) {
          return;
        }
        originalError(msg, options);
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), silentProxyErrors()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: 'Backend offline — start the API from project root: npm run dev',
                code: 'BACKEND_OFFLINE',
              }));
            }
          });
        },
      },
    },
  },
});
