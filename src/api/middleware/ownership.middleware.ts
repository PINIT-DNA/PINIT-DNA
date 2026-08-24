import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';
import {
  getAuthUserId,
  assertDnaOwner,
  assertVaultOwner,
  assertShareLinkOwnerByToken,
  assertMonitorOwner,
  assertCertificateOwnerByCertId,
  assertCrawlResultOwner,
  assertAssetOwner,
} from '../../lib/tenant-scope';

/**
 * Verify the authenticated user owns a DnaRecord.
 * Expects req.params.id or req.params.dnaRecordId
 */
export async function requireDnaOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const recordId = req.params['id'] ?? req.params['dnaRecordId'] ?? req.params['dnaId'];
    if (!recordId) return next(new AppError(400, 'DNA record ID required'));
    await assertDnaOwner(recordId, userId);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Verify the authenticated user owns a VaultRecord (via linked DnaRecord).
 */
export async function requireVaultOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const vaultId = req.params['id'] ?? req.params['vaultId'];
    if (!vaultId) return next(new AppError(400, 'Vault ID required'));
    await assertVaultOwner(vaultId, userId);
    next();
  } catch (err) {
    next(err);
  }
}

/** Verify share link ownership by URL token param. */
export async function requireShareLinkOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const token = req.params['token'];
    if (!token) return next(new AppError(400, 'Share token required'));
    await assertShareLinkOwnerByToken(token, userId);
    next();
  } catch (err) {
    next(err);
  }
}

/** Verify monitor ownership by :id param. */
export async function requireMonitorOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const monitorId = req.params['id'];
    if (!monitorId) return next(new AppError(400, 'Monitor ID required'));
    await assertMonitorOwner(monitorId, userId);
    next();
  } catch (err) {
    next(err);
  }
}

/** Verify certificate ownership by :certificateId param. */
export async function requireCertificateOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const certificateId = req.params['certificateId'];
    if (!certificateId) return next(new AppError(400, 'Certificate ID required'));
    await assertCertificateOwnerByCertId(certificateId, userId);
    next();
  } catch (err) {
    next(err);
  }
}

/** Verify asset ownership by :id param — independent of authentication. */
export async function requireAssetOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const assetId = req.params['id'];
    if (!assetId) return next(new AppError(400, 'Asset ID required'));
    await assertAssetOwner(assetId, userId);
    next();
  } catch (err) {
    next(err);
  }
}

/** Verify crawl-result alert belongs to user's monitor (:id = crawlResult id). */
export async function requireAlertOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const alertId = req.params['id'];
    if (!alertId) return next(new AppError(400, 'Alert ID required'));
    await assertCrawlResultOwner(alertId, userId);
    next();
  } catch (err) {
    next(err);
  }
}
