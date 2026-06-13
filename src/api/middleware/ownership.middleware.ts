import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { AppError } from './error.middleware';

/**
 * Verify the authenticated user owns a DnaRecord.
 * Expects req.params.id or req.params.dnaRecordId = dnaRecordId
 * Expects req.user.sub = userId (set by requireAuth middleware)
 *
 * Records with ownerUserId=null are treated as legacy/admin records
 * and are accessible to any authenticated user.
 */
export async function requireDnaOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as any).user?.sub;
    const recordId = req.params['id'] ?? req.params['dnaRecordId'];

    const record = await prisma.dnaRecord.findUnique({
      where: { id: recordId },
      select: { ownerUserId: true },
    });

    if (!record) return next(new AppError(404, 'Record not found'));

    // ownerUserId=null means legacy record — allow any authenticated user
    if (record.ownerUserId && record.ownerUserId !== userId) {
      return next(new AppError(403, 'Access denied'));
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Verify the authenticated user owns a VaultRecord (via its linked DnaRecord).
 * Expects req.params.id = vaultRecordId
 */
export async function requireVaultOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as any).user?.sub;
    const vaultId = req.params['id'];

    const vault = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      select: { dnaRecord: { select: { ownerUserId: true } } },
    });

    if (!vault) return next(new AppError(404, 'Vault record not found'));

    const ownerUserId = vault.dnaRecord?.ownerUserId;
    if (ownerUserId && ownerUserId !== userId) {
      return next(new AppError(403, 'Access denied'));
    }

    next();
  } catch (err) {
    next(err);
  }
}
