/**
 * Phase 2 — DNA Transformation History (variant lineage).
 * Stored in universalFingerprints.transformationHistory — no schema migration.
 */
import { prisma } from '../../lib/prisma';
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import type { TransformationHistoryEntry, TamperVector, TransformationStage } from '../../types/dna-enhancements.types';
import { logger } from '../../lib/logger';

const MAX_HISTORY = 50;

const VECTOR_TO_STAGE: Partial<Record<TamperVector, TransformationStage>> = {
  EXACT_COPY: 'ORIGINAL',
  COMPRESSION: 'COMPRESSED',
  REENCODE: 'REENCODED',
  SCREENSHOT: 'SCREENSHOT',
  SCREEN_RECORDING: 'SCREEN_RECORDING',
  AI_EDITING: 'AI_EDITED',
  AI_UPSCALE: 'AI_EDITED',
  CROP: 'CROPPED',
  WATERMARK_REMOVAL: 'AI_EDITED',
};

export class TransformationHistoryService {
  async append(
    dnaRecordId: string,
    tamperVector: TamperVector,
    similarityScore: number,
    sourceDnaRecordId?: string,
    notes?: string,
  ): Promise<void> {
    if (!isPhase2Active() || !dnaPhase2.transformationHistory) return;
    if (tamperVector === 'NONE' || tamperVector === 'UNKNOWN_TAMPER') return;

    try {
      const rec = await prisma.dnaRecord.findUnique({
        where: { id: dnaRecordId },
        select: { universalFingerprints: true },
      });
      if (!rec) return;

      const fp = (rec.universalFingerprints && typeof rec.universalFingerprints === 'object'
        ? { ...(rec.universalFingerprints as object) }
        : {}) as Record<string, unknown>;

      const history = (Array.isArray(fp.transformationHistory)
        ? fp.transformationHistory
        : []) as TransformationHistoryEntry[];

      const entry: TransformationHistoryEntry = {
        stage: VECTOR_TO_STAGE[tamperVector] ?? 'RECOVERED',
        detectedAt: new Date().toISOString(),
        tamperVector,
        similarityScore,
        sourceDnaRecordId,
        notes,
      };

      fp.transformationHistory = [entry, ...history].slice(0, MAX_HISTORY);

      await prisma.dnaRecord.update({
        where: { id: dnaRecordId },
        data: { universalFingerprints: fp as object },
      });
    } catch (err) {
      logger.warn('Transformation history append skipped (non-fatal)', { dnaRecordId, error: String(err) });
    }
  }

  getHistory(universalFingerprints: unknown): TransformationHistoryEntry[] {
    const fp = universalFingerprints as Record<string, unknown> | null;
    return (Array.isArray(fp?.transformationHistory) ? fp!.transformationHistory : []) as TransformationHistoryEntry[];
  }
}

export const transformationHistoryService = new TransformationHistoryService();
