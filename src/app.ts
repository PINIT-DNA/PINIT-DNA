/**
 * PINIT-DNA — Application Entry Point
 */

import 'express-async-errors';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import { logger } from './lib/logger';
import { dnaRouter } from './api/routes/dna.routes';
import { vaultRouter } from './api/routes/vault.routes';
import { errorMiddleware } from './api/middleware/error.middleware';

const app = express();

// ─── Static UI ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(
  morgan('dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);

// ─── Body parsers ─────────────────────────────────────────────────────────────
// Note: multipart/form-data is handled per-route by multer, not globally
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'pinit-dna',
    version: config.dna.schemaVersion,
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use(`${config.apiPrefix}/dna`, dnaRouter);
app.use(`${config.apiPrefix}/vault`, vaultRouter);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorMiddleware);

// ─── Start server ─────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(config.port, () => {
    logger.info(`PINIT-DNA API running`, {
      port: config.port,
      env: config.env,
      prefix: config.apiPrefix,
    });
  });
}

export { app };
