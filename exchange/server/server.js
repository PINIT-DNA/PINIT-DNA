import './load-env.js';
import express from 'express';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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
    app.listen(PORT, () => {
      const billing = getBillingPublicConfig();
      console.log(`====================================================`);
      console.log(`🚀 Pinit Exchange Server running on http://localhost:${PORT}`);
      console.log(`🔒 Hub API: ${process.env.HUB_API_URL || 'http://localhost:4000/api/v1'}`);
      console.log(`🔑 Bridge secret: ${process.env.EXCHANGE_BRIDGE_SECRET ? 'loaded' : 'MISSING'}`);
      console.log(`💳 Payments: ${billing.provider}${billing.mock ? ' (mock)' : ''}`);
      console.log(`🗄️  Database: ${dbDriver}${dbDriver === 'postgres' ? ' (schema exchange)' : ''}`);
      console.log(`📘 OpenAPI: http://localhost:${PORT}/api/docs`);
      console.log(`====================================================`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
