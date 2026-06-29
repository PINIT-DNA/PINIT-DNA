/**
 * Phase 2 — Self-Learning DNA (optional transformation profiles).
 * Stored in universalFingerprints.selfLearning — no schema migration.
 */
import { prisma } from '../../lib/prisma';
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import type { SelfLearningProfile, TamperVector, LayerScoreInput } from '../../types/dna-enhancements.types';
import { logger } from '../../lib/logger';

const MAX_PROFILES = 200;

export class SelfLearningDnaService {
  async recordVerification(
    dnaRecordId: string,
    tamperVector: TamperVector,
    layerScores: LayerScoreInput[],
  ): Promise<void> {
    if (!isPhase2Active() || !dnaPhase2.selfLearning) return;

    try {
      const rec = await prisma.dnaRecord.findUnique({
        where: { id: dnaRecordId },
        select: { universalFingerprints: true },
      });
      if (!rec) return;

      const fp = (rec.universalFingerprints && typeof rec.universalFingerprints === 'object'
        ? { ...(rec.universalFingerprints as object) }
        : {}) as Record<string, unknown>;

      const existing = (Array.isArray(fp.selfLearning) ? fp.selfLearning : []) as SelfLearningProfile[];

      const profile: SelfLearningProfile = {
        tamperVector,
        layerScorePattern: Object.fromEntries(layerScores.map((l) => [l.layer, l.score])),
        observedAt: new Date().toISOString(),
        dnaRecordId,
      };

      const updated = [profile, ...existing].slice(0, MAX_PROFILES);
      fp.selfLearning = updated;

      await prisma.dnaRecord.update({
        where: { id: dnaRecordId },
        data: { universalFingerprints: fp as object },
      });
    } catch (err) {
      logger.warn('Self-learning DNA record skipped (non-fatal)', { dnaRecordId, error: String(err) });
    }
  }

  /** Boost score when current pattern matches learned profile */
  boostFromLearning(
    universalFingerprints: unknown,
    tamperVector: TamperVector,
    layerScores: LayerScoreInput[],
  ): number {
    if (!isPhase2Active() || !dnaPhase2.selfLearning) return 0;

    const fp = universalFingerprints as Record<string, unknown> | null;
    const profiles = (Array.isArray(fp?.selfLearning) ? fp!.selfLearning : []) as SelfLearningProfile[];
    const matches = profiles.filter((p) => p.tamperVector === tamperVector);
    if (!matches.length) return 0;

    let best = 0;
    for (const p of matches.slice(0, 10)) {
      const pattern = p.layerScorePattern;
      let sim = 0;
      let count = 0;
      for (const ls of layerScores) {
        const learned = pattern[ls.layer];
        if (learned !== undefined) {
          sim += 1 - Math.abs(learned - ls.score);
          count++;
        }
      }
      if (count > 0) best = Math.max(best, sim / count);
    }
    return best * 0.05;
  }
}

export const selfLearningDnaService = new SelfLearningDnaService();
