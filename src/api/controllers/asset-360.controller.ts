/**
 * Creator Asset 360 controller (Phase 3).
 *
 * Authorization chain, enforced strictly in this order:
 *
 *   authenticated JWT user  (requireAuth -> req.user.sub)
 *         |
 *   getAuthUserId(req)      (JWT `sub` ONLY — never a body/query/header value)
 *         |
 *   Asset.ownerUserId       (matched inside the Prisma query)
 *         |
 *   allow only the owner
 *
 * A client-supplied `ownerUserId`, `userId` or PINIT ID is never read here, so
 * there is no parameter a caller can set to widen their own access. An asset
 * owned by someone else is reported as 404, identical to a non-existent id, so
 * the endpoint cannot be used to probe which asset ids exist.
 */
import { Request, Response, NextFunction } from 'express';
import { getAuthUserId } from '../../lib/tenant-scope';
import { getAssetActivityForOwner } from '../../services/assets/asset-360.service';

/**
 * GET /api/v1/creator/assets/:assetId/activity
 *
 * `:assetId` is the canonical Asset.id. VaultRecord.id and DnaRecord.id are not
 * accepted — they simply will not match an Asset row.
 */
export async function getCreatorAssetActivity(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // JWT-derived only. This is the single source of identity for the request.
    const ownerUserId = getAuthUserId(req);
    if (!ownerUserId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const assetId = String(req.params.assetId || '').trim();
    if (!assetId) {
      res.status(400).json({ success: false, error: 'assetId is required' });
      return;
    }

    const report = await getAssetActivityForOwner(assetId, ownerUserId);
    if (!report) {
      // Deliberately indistinguishable from "does not exist".
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
}
