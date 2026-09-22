/**
 * Asset tracking endpoints.
 *
 * GET /tracking/assets            — one row per asset, never one per share link
 * GET /tracking/assets/:assetId   — one asset, every channel it travelled through
 * GET /tracking/activity          — one row per FILE, with its whole log
 *
 * Ownership comes from the JWT only. An asset owned by someone else answers 404,
 * exactly as a missing one does, so the endpoint cannot be used to discover ids.
 */
import { Request, Response, NextFunction } from 'express';
import { getAuthUserId } from '../../lib/tenant-scope';
import {
  listTrackedAssets,
  getAssetTracking,
} from '../../services/tracking/asset-tracking.service';
import { getOwnerActivity } from '../../services/tracking/asset-activity.service';

export async function listTrackedAssetsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const limit = Number(req.query['limit']);
    const assets = await listTrackedAssets(ownerUserId, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ success: true, count: assets.length, assets });
  } catch (err) {
    next(err);
  }
}

export async function getAssetTrackingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const report = await getAssetTracking(String(req.params['assetId'] ?? ''), ownerUserId);
    if (!report) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }
    res.json({ success: true, ...report });
  } catch (err) {
    next(err);
  }
}

export async function getActivityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const limit = Number(req.query['limit']);
    const activity = await getOwnerActivity(ownerUserId, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ success: true, count: activity.files.length, ...activity });
  } catch (err) {
    next(err);
  }
}
