import { Router } from 'express';
import {
  generateReport,
  listEvidenceRecords,
  getEvidenceRecord,
  listIncidents,
  getIncident,
  updateIncidentStatus,
  listRecipients,
} from '../controllers/evidence-report.controller';

export const evidenceRouter = Router();

// ── Evidence Reports ──────────────────────────────────────────────────────────
evidenceRouter.post('/report',             generateReport);
evidenceRouter.get('/records',             listEvidenceRecords);
evidenceRouter.get('/records/:id',         getEvidenceRecord);

// ── Incidents ─────────────────────────────────────────────────────────────────
evidenceRouter.get('/incidents',           listIncidents);
evidenceRouter.get('/incidents/:id',       getIncident);
evidenceRouter.patch('/incidents/:id',     updateIncidentStatus);

// ── Recipient Profiles ────────────────────────────────────────────────────────
evidenceRouter.get('/recipients',          listRecipients);
