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

const router = Router();

/** POST /intelligence/ocr/:dnaRecordId — Extract text via OCR */
router.post('/ocr/:dnaRecordId', runOcr);

/** GET  /intelligence/search?q=...    — Semantic full-text search */
router.get('/search', semanticSearch);

/** GET  /intelligence/lineage/:id     — Document lineage graph */
router.get('/lineage/:dnaRecordId', getLineage);

/** GET  /intelligence/duplicates      — Find duplicate clusters */
router.get('/duplicates', getDuplicates);

/** GET  /intelligence/audit           — System-wide audit log */
router.get('/audit', getAuditLog);

/** GET  /intelligence/audit/export    — Download audit log as CSV (BEFORE /:id to avoid route clash) */
router.get('/audit/export', exportAuditCsv);

/** GET  /intelligence/audit/:id       — Audit for one DNA record */
router.get('/audit/:dnaRecordId', getAuditForRecord);

/** GET  /intelligence/report/:vaultId — Full document intelligence report */
router.get('/report/:vaultId', getIntelligenceReport);

/** GET  /intelligence/stats           — Intelligence statistics */
router.get('/stats', getIntelligenceStats);

/** GET  /intelligence/debug/indexed   — Show exactly what text is in FAISS */
router.get('/debug/indexed', debugIndexed);

/** GET  /intelligence/tika/health     — Apache Tika status */
router.get('/tika/health', tikaHealth);

/** POST /intelligence/tika/:dnaRecordId — Extract Tika metadata for a vaulted file */
router.post('/tika/:dnaRecordId', extractTikaMetadata);

export { router as intelligenceRouter };
