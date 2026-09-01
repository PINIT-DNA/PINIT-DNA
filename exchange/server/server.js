import './load-env.js';
import express from 'express'; // Exchange API + Hub preview proxy
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import fs from 'fs';
import { initDatabase, dbDriver } from './database.js';
import { getBillingPublicConfig } from './razorpay.js';
import { exchangeStorageConfigured } from './lib/exchange-storage.js';

import authRoutes from './routes/auth.js';
import hubRoutes from './routes/hub.js';
import listingsRoutes from './routes/listings.js';
import ordersRoutes from './routes/orders.js';
import creatorRoutes from './routes/creator.js';
import requirementsRoutes from './routes/requirements.js';
import commerceRoutes from './routes/commerce.js';
import portfolioRoutes from './routes/portfolio.js'; // public /p/:slug + seller builder API
import sellerOnboardingRoutes from './routes/seller-onboarding.js';
import webhookRoutes from './routes/webhooks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 5000);

/**
 * CORS allow-list.
 *
 * `cors()` with no options answers every origin with a wildcard, so any website
 * could call this API from a visitor's browser. The allow-list below is built
 * from the deployment's own public URLs plus local dev, and can be extended
 * with CORS_ALLOWED_ORIGINS (comma-separated) without a code change.
 *
 * Requests with no Origin header (server-to-server, curl, the Hub bridge) are
 * still allowed — CORS is a browser control and blocking those would break the
 * bridge without adding protection.
 */
const allowedOrigins = new Set(
  [
    process.env.EXCHANGE_PUBLIC_URL,
    process.env.HUB_APP_URL,
    'https://www.pinitexchange.com',
    'https://pinitexchange.com',
    'http://localhost:5174',
    'http://localhost:3002',
    ...String(process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((o) => o.trim()),
  ]
    .filter(Boolean)
    .map((o) => o.replace(/\/$/, '')),
);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(String(origin).replace(/\/$/, ''))) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
// The raw body is kept alongside the parsed one so webhook signatures can be
// verified. A gateway signs the exact bytes it sent; re-serialising the parsed
// object produces different bytes (key order, whitespace, number formatting)
// and the signature would never match.
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'INVALID_JSON',
      message: 'Request body must be valid JSON',
    });
  }
  return next(err);
});

let openapiDoc = { openapi: '3.0.3', info: { title: 'Pinit Exchange API', version: '1.0.0' }, paths: {} };
try {
  const raw = fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8');
  openapiDoc = YAML.parse(raw);
} catch (e) {
  console.warn('[openapi] Could not load openapi.yaml:', e.message);
}

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc, { customSiteTitle: 'Pinit Exchange API' }));
app.get('/api/openapi.json', (_req, res) => res.json(openapiDoc));

app.use('/api/auth', authRoutes);
app.use('/api/hub', hubRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/creator', creatorRoutes);
app.use('/api/requirements', requirementsRoutes);
app.use('/api/commerce', commerceRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/seller/onboarding', sellerOnboardingRoutes);
// Inbound gateway callbacks. Authenticated by HMAC signature, not by session.
app.use('/api/webhooks', webhookRoutes);

app.get('/api/health', (req, res) => {
  const billing = getBillingPublicConfig();
  res.json({
    status: 'online',
    product: 'Pinit Exchange Backend Engine',
    hub_link_status: process.env.EXCHANGE_BRIDGE_SECRET ? 'bridge_configured' : 'bridge_missing',
    hub_api: process.env.HUB_API_URL || 'http://localhost:4000/api/v1',
    database: {
      driver: dbDriver,
      schema: dbDriver === 'postgres' ? 'exchange' : 'sqlite',
    },
    storage: {
      configured: exchangeStorageConfigured(),
      buckets: ['exchange-previews', 'exchange-deliveries'],
      hub_vault_isolated: true,
    },
    payments: billing,
    sealed_ledger: 'active_tamper_proof',
    docs: '/api/docs',
    timestamp: new Date().toISOString(),
  });
});

initDatabase()
  .then(() => {
    const server = app.listen(PORT, () => {
      const billing = getBillingPublicConfig();
      console.log(`====================================================`);
      console.log(`🚀 Pinit Exchange Server running on http://localhost:${PORT}`);
      console.log(`🔒 Hub API: ${process.env.HUB_API_URL || 'http://localhost:4000/api/v1'}`);
      console.log(`🔑 Bridge secret: ${process.env.EXCHANGE_BRIDGE_SECRET ? 'loaded' : 'MISSING'}`);
      console.log(`💳 Payments: ${billing.provider}${billing.mock ? ' (mock)' : ''}`);
      console.log(`🗄️  Database: ${dbDriver}${dbDriver === 'postgres' ? ' (schema exchange)' : ''}`);
      console.log(`📘 OpenAPI: http://localhost:${PORT}/api/docs`);
      console.log(`====================================================`);
      console.log(`[exchange] ready`);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[exchange] Port ${PORT} already in use. Stop the other Exchange API, then retry.`);
        process.exit(1);
      }
      console.error('[exchange] Server listen error:', err);
      process.exit(1);
    });
  })
  .catch((err) => {
    const message = err?.message || String(err);
    console.error(message.startsWith('FATAL:') ? message : `FATAL: Failed to initialize database: ${message}`);
    process.exit(1);
  });
