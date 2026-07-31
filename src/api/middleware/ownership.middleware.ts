import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { AppError } from './error.middleware';
import { getAuthUserId, assertRecordOwner } from '../../lib/tenant-scope';

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

    const record = await prisma.dnaRecord.findUnique({
      where: { id: recordId },
      select: { ownerUserId: true },
    });

    if (!record) return next(new AppError(404, 'Record not found'));
    assertRecordOwner(record.ownerUserId, userId, 'DNA record');
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

    const vault = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      select: { dnaRecord: { select: { ownerUserId: true } } },
    });

    if (!vault) return next(new AppError(404, 'Vault record not found'));
    assertRecordOwner(vault.dnaRecord?.ownerUserId, userId, 'Vault');
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

    const link = await prisma.shareLink.findUnique({
      where: { token },
      select: { ownerUserId: true },
    });
    if (!link) return next(new AppError(404, 'Share link not found'));
    assertRecordOwner(link.ownerUserId, userId, 'Share link');
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

    const mon = await prisma.monitorRecord.findUnique({
      where: { id: monitorId },
      select: { ownerUserId: true },
    });
    if (!mon) return next(new AppError(404, 'Monitor not found'));
    assertRecordOwner(mon.ownerUserId, userId, 'Monitor');
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

    const { assertCertificateOwnerByCertId } = await import('../../lib/tenant-scope');
    await assertCertificateOwnerByCertId(certificateId, userId);
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

    const { assertCrawlResultOwner } = await import('../../lib/tenant-scope');
    await assertCrawlResultOwner(alertId, userId);
    next();
  } catch (err) {
    next(err);
  }
}
