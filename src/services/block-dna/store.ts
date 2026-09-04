import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { BLOCK_DNA_FILE_ANALYSIS_KEY } from '../../config/block-dna';
import type { StoredBlockDnaManifest } from '../../types/block-dna.types';

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function persistBlockDnaManifest(
  dnaRecordId: string,
  stored: StoredBlockDnaManifest,
): Promise<void> {
  try {
    const row = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { fileAnalysis: true },
    });
    if (!row) return;
    const next = asRecord(row.fileAnalysis);
    next[BLOCK_DNA_FILE_ANALYSIS_KEY] = stored;
    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { fileAnalysis: next as object },
    });
  } catch (err) {
    logger.warn('Block DNA — persist skipped', {
      dnaRecordId,
      error: String(err),
    });
  }
}

export async function loadStoredBlockDnaManifest(
  dnaRecordId: string,
): Promise<StoredBlockDnaManifest | null> {
  try {
    const row = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { fileAnalysis: true },
    });
    const stored = asRecord(row?.fileAnalysis)[BLOCK_DNA_FILE_ANALYSIS_KEY];
    if (!stored || typeof stored !== 'object') return null;
    const s = stored as StoredBlockDnaManifest;
    if (!s.tagsB64 || !s.imageId) return null;
    return s;
  } catch {
    return null;
  }
}
