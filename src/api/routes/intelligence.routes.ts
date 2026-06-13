/**
 * PINIT-DNA — Document Intelligence Routes (Phase 5)
 */

import { Router } from 'express';
import {
  runOcr,
  semanticSearch,
  getLineage,
  getDuplicates,
  getAuditLog,
  getAuditForRecord,
  getIntelligenceStats,
  exportAuditCsv,
  getIntelligenceReport,
} from '../controllers/document-intelligence.controller';
import { debugIndexed }          from '../controllers/debug-index.controller';
import { tikaHealth, extractTikaMetadata } from '../controllers/tika.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

/** POST /intelligence/ocr/:dnaRecordId — Extract text via OCR */
router.post('/ocr/:dnaRecordId', requireAuth, runOcr);

/** GET  /intelligence/search?q=...    — Semantic full-text search */
router.get('/search', requireAuth, semanticSearch);

/** GET  /intelligence/lineage/:id     — Document lineage graph */
router.get('/lineage/:dnaRecordId', requireAuth, getLineage);

/** GET  /intelligence/duplicates      — Find duplicate clusters */
router.get('/duplicates', requireAuth, getDuplicates);

/** GET  /intelligence/audit           — System-wide audit log */
router.get('/audit', requireAuth, getAuditLog);

/** GET  /intelligence/audit/export    — Download audit log as CSV (BEFORE /:id to avoid route clash) */
router.get('/audit/export', requireAuth, exportAuditCsv);

/** GET  /intelligence/audit/:id       — Audit for one DNA record */
router.get('/audit/:dnaRecordId', requireAuth, getAuditForRecord);

/** GET  /intelligence/report/:vaultId — Full document intelligence report */
router.get('/report/:vaultId', requireAuth, getIntelligenceReport);

/** GET  /intelligence/stats           — Intelligence statistics */
router.get('/stats', requireAuth, getIntelligenceStats);

/** GET  /intelligence/debug/indexed   — Show exactly what text is in FAISS */
router.get('/debug/indexed', requireAuth, debugIndexed);

/** GET  /intelligence/tika/health     — Apache Tika status */
router.get('/tika/health', tikaHealth);   // public health check

/** POST /intelligence/tika/:dnaRecordId — Extract Tika metadata for a vaulted file */
router.post('/tika/:dnaRecordId', requireAuth, extractTikaMetadata);

export { router as intelligenceRouter };
