import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  getMyPortfolio,
  saveMyPortfolio,
  publishMyPortfolio,
  unpublishMyPortfolio,
  previewMyPortfolio,
  getPublicPortfolio,
} from '../controllers/portfolio.controller';

const router = Router();

router.get('/me', requireAuth, getMyPortfolio);
router.put('/me', requireAuth, saveMyPortfolio);
router.post('/me/publish', requireAuth, publishMyPortfolio);
router.post('/me/unpublish', requireAuth, unpublishMyPortfolio);
router.get('/me/preview', requireAuth, previewMyPortfolio);
router.get('/public/:slug', getPublicPortfolio);

export { router as portfolioRouter };
