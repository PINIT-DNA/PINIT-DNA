/**
 * Lifecycle read endpoints.
 *
 * GET /lifecycle/assets/:assetId — one asset's connected history
 * GET /lifecycle/me              — recent lifecycle across the caller's account
 *
 * Ownership comes from the JWT only. A client-supplied owner id cannot widen access,
 * and an asset owned by someone else answers 404 exactly like a missing one.
 */
import { Request, Response, NextFunction } from 'express';
import { getAuthUserId } from '../../lib/tenant-scope';
import {
  getAssetLifecycle,
  getOwnerLifecycle,
} from '../../services/lifecycle/lifecycle-query.service';
import { LIFECYCLE_STAGES, type LifecycleStage } from '../../services/lifecycle/lifecycle-types';

export async function getAssetLifecycleHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const assetId = String(req.params['assetId'] ?? '').trim();
    const limit = Number(req.query['limit']);

    const report = await getAssetLifecycle(assetId, ownerUserId, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    if (!report) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }
    res.json({ success: true, ...report });
  } catch (err) {
    next(err);
  }
}

export async function getMyLifecycleHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const limit = Number(req.query['limit']);
    const requestedStage = String(req.query['stage'] ?? '').trim();
    const stage = (LIFECYCLE_STAGES as readonly string[]).includes(requestedStage)
      ? (requestedStage as LifecycleStage)
      : undefined;

    const events = await getOwnerLifecycle(ownerUserId, {
      limit: Number.isFinite(limit) ? limit : undefined,
      stage,
    });
    res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
}
