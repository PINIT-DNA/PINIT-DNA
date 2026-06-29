/**
 * PINIT-DNA — Application Entry Point
 */

import './bootstrap-env';

import 'express-async-errors';
import fs   from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { dnaRouter }               from './api/routes/dna.routes';
import { vaultRouter }             from './api/routes/vault.routes';
import { intelligenceRouter }      from './api/routes/intelligence.routes';
import { certificateMgmtRouter }   from './api/routes/certificate-mgmt.routes';
import { forensicDiffRouter }      from './api/routes/forensic-diff.routes';
import { unifiedInvestigationRouter } from './api/routes/unified-investigation.routes';
import { aiRouter }               from './api/routes/ai.routes';
import { monitoringRouter }        from './api/routes/monitoring.routes';
import { shareRouter }            from './api/routes/share.routes';
import { recipientsRouter }       from './api/routes/recipients.routes';
import { evidenceRouter }         from './api/routes/evidence.routes';
import { authRouter }             from './api/routes/auth.routes';
import { profileRouter }          from './api/routes/profile.routes';
import { notificationRouter }     from './api/routes/notification.routes';
import { adminRouter }            from './api/routes/admin.routes';
import { tepRouter }              from './api/routes/tep.routes';
import { getHealthReport }         from './lib/health';
import { errorMiddleware } from './api/middleware/error.middleware';

const app = express();

// ─── Static UI ────────────────────────────────────────────────────────────────
// Serve React build (client/dist) if it exists, otherwise fall back to public/
const reactBuildPath = path.join(__dirname, '..', 'client', 'dist');
const publicPath     = path.join(__dirname, '..', 'public');

if (fs.existsSync(reactBuildPath)) {
  app.use(express.static(reactBuildPath));
} else {
  app.use(express.static(publicPath));
}

// ─── Trust proxy (Render/Vercel/ngrok) — 1 hop only to avoid rate-limit bypass warning
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allows: localhost (any port) + ALL ngrok domains + optional custom domain
app.use(cors({
  origin: (origin, callback) => {
    // No origin = server-to-server, Postman, curl → always allow
    if (!origin) return callback(null, true);

    const allowed =
      origin.includes('localhost')       ||
      origin.includes('127.0.0.1')       ||
      origin.includes('ngrok.io')        ||
      origin.includes('ngrok-free.app')  ||
      origin.includes('ngrok-free.dev')  ||
      origin.includes('ngrok.app')       ||
      origin.includes('vercel.app')      ||   // ← Vercel preview + production deployments
      (!!process.env['ALLOWED_ORIGIN'] && origin === process.env['ALLOWED_ORIGIN']);

    if (allowed) return callback(null, true);

    // Log denied origins for debugging — do NOT throw, just deny
    logger.warn('CORS: origin denied', { origin });
    return callback(null, false);   // ← returns 403, NOT 500
  },
  credentials: true,
}));

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(
  morgan('dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Skip rate limiting for public share viewer endpoints (no auth needed)
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  skip: (req) =>
    process.env['NODE_ENV'] !== 'production' ||
    (req.path.startsWith('/api/v1/share/') && req.method === 'GET'),
});
app.use(apiLimiter);

// ─── Health check (Phase 6 — detailed) ────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const report = await getHealthReport();
  const httpStatus = report.status === 'healthy' ? 200 : report.status === 'degraded' ? 207 : 503;
  res.status(httpStatus).json(report);
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use(`${config.apiPrefix}/dna`,          dnaRouter);
app.use(`${config.apiPrefix}/vault`,        vaultRouter);
app.use(`${config.apiPrefix}/intelligence`, intelligenceRouter);
app.use(`${config.apiPrefix}/certificates`, certificateMgmtRouter);
app.use(`${config.apiPrefix}/forensic`,    forensicDiffRouter);
app.use(`${config.apiPrefix}/forensics`,   unifiedInvestigationRouter);
app.use(`${config.apiPrefix}/ai`,         aiRouter);
app.use(`${config.apiPrefix}/monitor`,   monitoringRouter);
app.use(`${config.apiPrefix}/share`,      shareRouter);
app.use(`${config.apiPrefix}/recipients`, recipientsRouter);
app.use(`${config.apiPrefix}/evidence`,   evidenceRouter);
app.use(`${config.apiPrefix}/auth`,      authRouter);
app.use(`${config.apiPrefix}/profile`,       profileRouter);
app.use(`${config.apiPrefix}/notifications`, notificationRouter);
app.use(`${config.apiPrefix}/admin`,         adminRouter);
app.use(`${config.apiPrefix}/tep`,           tepRouter);

// ─── Share viewer with dynamic OG meta tags (trackable preview) ──────────────
// When WhatsApp/Telegram crawl /s/:token, they get OG tags with our trackable
// preview image URL. Tapping the preview opens the share viewer (tracked).
app.get('/s/:token', async (req, res) => {
  const reactIndex = path.join(__dirname, '..', 'client', 'dist', 'index.html');
  if (!fs.existsSync(reactIndex)) {
    res.status(404).json({ success: false, error: 'Route not found' });
    return;
  }

  const { token } = req.params;
  let title = 'PINIT DNA — Secure File';
  let description = 'Access this encrypted file securely. Protected by PINIT DNA.';
  let filename = 'Secure File';

  try {
    const link = await prisma.shareLink.findUnique({ where: { token } });
    if (link) {
      filename = link.filename || 'Secure File';
      title = `${filename} — PINIT DNA`;
      description = `🔒 ${filename} · AES-256-GCM Encrypted · Access tracked. Open to view this secure file.`;
    }
  } catch { /* serve with defaults */ }

  const previewUrl = `https://${req.get('host')}${config.apiPrefix}/share/${token}/preview.png`;
  const pageUrl = `https://${req.get('host')}/s/${token}`;

  let html = fs.readFileSync(reactIndex, 'utf-8');
  const ogTags = `
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />
    <meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />
    <meta property="og:image" content="${previewUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${pageUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title.replace(/"/g, '&quot;')}" />
    <meta name="twitter:description" content="${description.replace(/"/g, '&quot;')}" />
    <meta name="twitter:image" content="${previewUrl}" />`;
  html = html.replace('</head>', `${ogTags}\n  </head>`);
  res.send(html);
});

// ─── React SPA catch-all ─────────────────────────────────────────────────────
// Serves index.html for /dashboard, /compare, /vault etc. (client-side routing)
app.get('*', (_req, res) => {
  const reactIndex = path.join(__dirname, '..', 'client', 'dist', 'index.html');
  if (fs.existsSync(reactIndex)) {
    res.sendFile(reactIndex);
  } else {
    res.status(404).json({ success: false, error: 'Route not found' });
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorMiddleware);

export { app };
