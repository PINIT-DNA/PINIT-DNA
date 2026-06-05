import { Router } from 'express';
import {
  aiHealth, indexDocument, semanticSearch,
  detectDuplicates, findSimilar, generateEmbedding, aiStats,
} from '../controllers/ai.controller';
import { reindexAll } from '../controllers/ai-reindex.controller';

const router = Router();

router.get('/health',              aiHealth);
router.get('/stats',               aiStats);
router.post('/embed',              generateEmbedding);
router.post('/index/:dnaRecordId', indexDocument);
router.post('/search',             semanticSearch);
router.post('/duplicates',         detectDuplicates);
router.post('/similar',            findSimilar);
router.post('/reindex-all',        reindexAll);

export { router as aiRouter };
