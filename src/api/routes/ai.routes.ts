import { Router } from 'express';
import {
  aiHealth, indexDocument, semanticSearch,
  detectDuplicates, findSimilar, generateEmbedding, aiStats,
} from '../controllers/ai.controller';
import { reindexAll } from '../controllers/ai-reindex.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.get('/health',              aiHealth);           // public health check
router.get('/stats',               requireAuth, aiStats);
router.post('/embed',              requireAuth, generateEmbedding);
router.post('/index/:dnaRecordId', requireAuth, indexDocument);
router.post('/search',             requireAuth, semanticSearch);
router.post('/duplicates',         requireAuth, detectDuplicates);
router.post('/similar',            requireAuth, findSimilar);
router.post('/reindex-all',        requireAuth, reindexAll);

export { router as aiRouter };
