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
import { buildShareViewerUrl } from './lib/share-viewer-url';
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
import { superAdminRouter }       from './api/routes/super-admin.routes';
import { tepRouter }              from './api/routes/tep.routes';
import { subscriptionRouter }     from './api/routes/subscription.routes';
import { organizationRouter }     from './api/routes/organization.routes';
import { businessRouter }         from './api/routes/business.routes';
import { publishGuardianRouter }  from './api/routes/publish-guardian.routes';
import { assetRouter }            from './api/routes/asset.routes';
import { exchangeRouter }         from './api/routes/exchange.routes';
import { adminBridgeRouter }      from './api/routes/admin-bridge.routes';
import { creatorRouter }          from './api/routes/creator.routes';
import {
  issueExtensionAuthCode,
  exchangeExtensionAuthToken,
} from './api/controllers/publish-guardian.controller';
import { requireAuth } from './api/middleware/auth.middleware';
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
// Allows: localhost + ngrok + Vercel + Pinit HUB custom domains + ALLOWED_ORIGIN(S)
app.use(cors({
  origin: (origin, callback) => {
    // No origin = server-to-server, Postman, curl → always allow
    if (!origin) return callback(null, true);

    const extraOrigins = [
      process.env['ALLOWED_ORIGIN'] ?? '',
      ...(process.env['ALLOWED_ORIGINS'] ?? '').split(','),
    ]
      .map((value) => value.trim())
      .filter(Boolean);

    const allowed =
      origin.includes('localhost')       ||
      origin.includes('127.0.0.1')       ||
      origin.includes('ngrok.io')        ||
      origin.includes('ngrok-free.app')  ||
      origin.includes('ngrok-free.dev')  ||
      origin.includes('ngrok.app')       ||
      origin.includes('vercel.app')      ||   // Vercel preview + production
      origin.includes('pinithub.com')    ||   // custom domain (apex + www)
      origin.includes('pinitexchange.com') || // Exchange custom domain (optional)
      origin.includes('exchange.pinithub.com') ||
      origin.startsWith('chrome-extension://') || // Chrome Publish Guardian
      origin.startsWith('extension://') ||       // Edge / Chromium-edge extensions
      extraOrigins.includes(origin);

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
    req.path === '/health' ||
    req.path === `${config.apiPrefix}/ping` ||
    req.path === `${config.apiPrefix}/health` ||
    (req.path.startsWith('/api/v1/share/') && req.method === 'GET'),
});

// ─── Health check (Phase 6 — detailed) — before rate limiter ─────────────────
/** Instant liveness — used by Vite proxy / dev auto-retry (no DB). */
app.get(`${config.apiPrefix}/ping`, (_req, res) => {
  res.json({ ok: true, service: 'pinit-dna-api', ts: Date.now() });
});

app.get(`${config.apiPrefix}/health`, async (_req, res) => {
  const report = await getHealthReport();
  const httpStatus = report.status === 'healthy' ? 200 : report.status === 'degraded' ? 207 : 503;
  res.status(httpStatus).json(report);
});

app.get('/health', async (_req, res) => {
  const report = await getHealthReport();
  const httpStatus = report.status === 'healthy' ? 200 : report.status === 'degraded' ? 207 : 503;
  res.status(httpStatus).json(report);
});

app.use(apiLimiter);

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
// /api/v1/admin (legacy adminRouter) retired — it gated role-change/toggle
// on plain ADMIN role with no owner check, a weaker parallel path to the
// same destructive actions super-admin now locks to the platform owner.
app.use(`${config.apiPrefix}/super-admin`,   superAdminRouter);
app.use(`${config.apiPrefix}/tep`,           tepRouter);
app.use(`${config.apiPrefix}/subscription`,  subscriptionRouter);
app.use(`${config.apiPrefix}/organization`,   organizationRouter);
app.use(`${config.apiPrefix}/business`,       businessRouter);
/** Publish Guardian — /api/v1/extension/* and /api/v1/posts* (additive) */
app.use(`${config.apiPrefix}`, publishGuardianRouter);
app.use(`${config.apiPrefix}`, assetRouter);
/** Exchange bridge — Hub master identity + list/sale handoff */
app.use(`${config.apiPrefix}/exchange`, exchangeRouter);
/** Master Admin bridge — separate app SSO handoff */
app.use(`${config.apiPrefix}/admin-bridge`, adminBridgeRouter);
app.use(`${config.apiPrefix}/creator`, creatorRouter);

/** Extension OAuth (additive — does not change password/biometric login) */
app.post(`${config.apiPrefix}/auth/extension/issue-code`, requireAuth, issueExtensionAuthCode);
app.post(`${config.apiPrefix}/auth/extension/token`, exchangeExtensionAuthToken);

// Recipients must land on the Hub frontend viewer, not this API process.
app.get('/share/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) {
    res.status(400).type('html').send('Link unavailable');
    return;
  }
  res.redirect(302, buildShareViewerUrl(token));
});

// ─── Share viewer with dynamic OG meta tags (trackable preview) ──────────────
// When WhatsApp/Telegram crawl /s/:token, they get OG tags with our trackable
// preview image URL. Tapping the preview opens the share viewer (tracked).
app.get('/s/:token', async (req, res) => {
  const { token } = req.params;
  const viewerUrl = buildShareViewerUrl(String(token || ''));
  const reactIndex = path.join(__dirname, '..', 'client', 'dist', 'index.html');
  if (!fs.existsSync(reactIndex)) {
    res.redirect(302, viewerUrl);
    return;
  }
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
  const pageUrl = viewerUrl;

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
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ success: false, error: 'Route not found' });
    return;
  }
  if (req.path.startsWith('/s/') || req.path.startsWith('/share/')) {
    const token = req.path.split('/').filter(Boolean)[1] || '';
    if (token) {
      res.redirect(302, buildShareViewerUrl(token));
      return;
    }
  }
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
