/**
 * Pinit ecosystem lifecycle routes (read-only).
 *
 * Owner-scoped by the JWT alone — there is no query parameter that can widen access,
 * and nothing here exposes Vault, DNA or certificate internals beyond what the owner
 * already sees on their own asset.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  getAssetLifecycleHandler,
  getMyLifecycleHandler,
} from '../controllers/lifecycle.controller';

const router = Router();

/** GET /lifecycle/me — recent lifecycle across the caller's own account */
router.get('/me', requireAuth, getMyLifecycleHandler);

/** GET /lifecycle/assets/:assetId — one asset's connected lifecycle */
router.get('/assets/:assetId', requireAuth, getAssetLifecycleHandler);

export { router as lifecycleRouter };
