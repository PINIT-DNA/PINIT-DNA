import { Router } from 'express';
import { getForwardChain } from '../controllers/forward-chain.controller';
import {
  getEvidencePublicKeyHandler,
  verifyEvidenceReport,
  signReportManifestHandler,
} from '../controllers/evidence-verify.controller';
import {
  generateReport,
  listEvidenceRecords,
  getEvidenceRecord,
  listIncidents,
  getIncident,
  updateIncidentStatus,
  listRecipients,
} from '../controllers/evidence-report.controller';
import { requireAuth } from '../middleware/auth.middleware';

export const evidenceRouter = Router();

// ── Phase 3 — Signed reports & QR verification ───────────────────────────────
evidenceRouter.get('/public-key',              getEvidencePublicKeyHandler);
evidenceRouter.get('/verify/:reportId',        verifyEvidenceReport);
evidenceRouter.post('/verify/:reportId',       verifyEvidenceReport);
evidenceRouter.post('/sign-manifest',          requireAuth, signReportManifestHandler);

// ── Evidence Reports ──────────────────────────────────────────────────────────
evidenceRouter.post('/report',             requireAuth, generateReport);
evidenceRouter.get('/records',             requireAuth, listEvidenceRecords);
evidenceRouter.get('/records/:id',         requireAuth, getEvidenceRecord);

// ── Incidents ─────────────────────────────────────────────────────────────────
evidenceRouter.get('/incidents',           requireAuth, listIncidents);
evidenceRouter.get('/incidents/:id',       requireAuth, getIncident);
evidenceRouter.patch('/incidents/:id',     requireAuth, updateIncidentStatus);

// ── Recipient Profiles ────────────────────────────────────────────────────────
evidenceRouter.get('/recipients',          requireAuth, listRecipients);

// ── Forward Chain Graph ───────────────────────────────────────────────────────
evidenceRouter.get('/chain/:dnaRecordId',  requireAuth, getForwardChain);
