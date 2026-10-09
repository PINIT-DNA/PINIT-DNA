import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

/**
 * Appends one export to the stored origin history.
 * The original merkle root stays as first written.
 */
export async function appendExportLineage(dnaRecordId: string, exportedSha256: string): Promise<void> {
  try {
    const row = await prisma.evolutionLayer.findUnique({
      where: { dnaRecordId },
      select: { mutationLog: true },
    });
    if (!row) return;
    const log = Array.isArray(row.mutationLog) ? [...row.mutationLog] : [];
    log.push({
      version: log.length + 1,
      hash: exportedSha256,
      ts: new Date().toISOString(),
      type: 'DERIVED',
    });
    await prisma.evolutionLayer.update({
      where: { dnaRecordId },
      data: { mutationLog: log as object, version: log.length },
    });
  } catch (err) {
    logger.warn('Export lineage append skipped', { dnaRecordId, error: String(err) });
  }
}
