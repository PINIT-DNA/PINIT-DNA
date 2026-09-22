/**
 * Asset tracking routes (read-only).
 *
 * One asset keeps one row here no matter how many times it was shared, sold or
 * checked. Everything is owner-scoped by the JWT; nothing in this router writes.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  listTrackedAssetsHandler,
  getAssetTrackingHandler,
  getActivityHandler,
} from '../controllers/tracking.controller';

const router = Router();

/** GET /tracking/assets — every protected asset with what happened to it */
router.get('/assets', requireAuth, listTrackedAssetsHandler);

/** GET /tracking/assets/:assetId — shares, certificate, purchases, monitoring */
router.get('/assets/:assetId', requireAuth, getAssetTrackingHandler);

/** GET /tracking/activity — one row per file with its whole log, oldest event first */
router.get('/activity', requireAuth, getActivityHandler);

export { router as trackingRouter };
