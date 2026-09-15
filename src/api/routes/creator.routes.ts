/**
 * Creator-facing asset routes (Phase 3 — Asset 360).
 *
 * Every route requires a Hub JWT and resolves ownership from that token alone.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { getCreatorAssetActivity } from '../controllers/asset-360.controller';

const router = Router();

router.get('/assets/:assetId/activity', requireAuth, getCreatorAssetActivity);

export const creatorRouter = router;
