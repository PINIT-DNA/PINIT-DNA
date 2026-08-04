/**
 * DNA immutability policy:
 * - DNA records are never hard-deleted by the application.
 * - Users may only delete vault (encrypted file) rows; DNA identity stays for audit/forensics.
 * - Probe/temp DNA used during verification is soft-archived (status FAILED), never deleted.
 */

import { prisma } from './prisma';
import { logger } from './logger';

export const DNA_IMMUTABLE_ERROR =
  'DNA_IMMUTABLE: DNA records cannot be deleted. Users may only delete vault files.';

/** Soft-archive a probe/temp DNA row instead of deleting it. */
export async function softArchiveProbeDna(dnaRecordId: string, reason = 'probe_cleanup'): Promise<void> {
  try {
    const existing = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { id: true, imageFilename: true, ownerUserId: true, vaultRecord: { select: { id: true } } },
    });
    if (!existing) return;
    // Never touch DNA that already has a vault (real protected asset)
    if (existing.vaultRecord) {
      logger.warn('DNA soft-archive skipped — vault exists', { dnaRecordId, reason });
      return;
    }
    const prefix = existing.imageFilename.startsWith('[probe] ') ? '' : '[probe] ';
    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: {
        status: 'FAILED',
        imageFilename: `${prefix}${existing.imageFilename}`.slice(0, 500),
      },
    });
    logger.info('DNA probe soft-archived (not deleted)', { dnaRecordId, reason });
  } catch (err) {
    logger.warn('DNA soft-archive failed', { dnaRecordId, reason, error: String(err) });
  }
}
