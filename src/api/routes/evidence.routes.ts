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
import { requireFeature, FeatureKey } from '../../services/subscription';

export const evidenceRouter = Router();

// ── Phase 3 — Signed reports & QR verification ───────────────────────────────
evidenceRouter.get('/public-key',              getEvidencePublicKeyHandler);
evidenceRouter.get('/verify/:reportId',        verifyEvidenceReport);
evidenceRouter.post('/verify/:reportId',       verifyEvidenceReport);
evidenceRouter.post('/sign-manifest',          requireAuth, requireFeature(FeatureKey.FEATURE_INVESTIGATION), signReportManifestHandler);

// ── Evidence Reports ──────────────────────────────────────────────────────────
evidenceRouter.post('/report',             requireAuth, requireFeature(FeatureKey.FEATURE_INVESTIGATION), generateReport);
evidenceRouter.get('/records',             requireAuth, requireFeature(FeatureKey.FEATURE_INVESTIGATION), listEvidenceRecords);
evidenceRouter.get('/records/:id',         requireAuth, requireFeature(FeatureKey.FEATURE_INVESTIGATION), getEvidenceRecord);

// ── Incidents ─────────────────────────────────────────────────────────────────
evidenceRouter.get('/incidents',           requireAuth, requireFeature(FeatureKey.FEATURE_TRACKING), listIncidents);
evidenceRouter.get('/incidents/:id',       requireAuth, requireFeature(FeatureKey.FEATURE_TRACKING), getIncident);
evidenceRouter.patch('/incidents/:id',     requireAuth, requireFeature(FeatureKey.FEATURE_TRACKING), updateIncidentStatus);

// ── Recipient Profiles ────────────────────────────────────────────────────────
evidenceRouter.get('/recipients',          requireAuth, listRecipients);

// ── Forward Chain Graph ───────────────────────────────────────────────────────
evidenceRouter.get('/chain/:dnaRecordId',  requireAuth, getForwardChain);
