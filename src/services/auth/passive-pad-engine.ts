/**
 * Server passive PAD seam.
 * The live implementation is still the temporary frame check in face-liveness.
 * It is not a certified presentation-attack detector.
 * Only verdict LIVE may continue. UNKNOWN is not LIVE.
 */
import { logger } from '../../lib/logger';
import { consumePadEvidence, type PadEvidence, type PadEvaluation } from './face-liveness.service';

export type PassivePadVerdict = 'LIVE' | 'SPOOF' | 'UNKNOWN' | 'ERROR';

export function traceBiometric(event: string, fields?: Record<string, string | number | boolean | null>): void {
  logger.info(`[Biometric] ${event}`, fields ?? {});
}

export async function verifyPassivePad(evidence: PadEvidence | null | undefined): Promise<PadEvaluation> {
  try {
    const evaluation = await consumePadEvidence(evidence);
    const verdict: PassivePadVerdict = evaluation.verdict === 'LIVE' || evaluation.verdict === 'SPOOF' || evaluation.verdict === 'UNKNOWN'
      ? evaluation.verdict
      : 'ERROR';
    traceBiometric(`pad=${verdict}`, {
      productionGrade: false,
      engineId: 'passive-heuristic-v1',
      reason: evaluation.reasons[0] ?? null,
    });
    return verdict === evaluation.verdict
      ? evaluation
      : { ...evaluation, verdict: 'UNKNOWN', reasons: ['unmapped_verdict'] };
  } catch (err) {
    traceBiometric('pad=ERROR', { productionGrade: false, engineId: 'passive-heuristic-v1' });
    logger.warn('[Biometric] passive PAD error', { error: err instanceof Error ? err.message : 'unknown' });
    return {
      verdict: 'UNKNOWN',
      reasons: ['pad_error'],
      scores: { motion: 0, sharpness: 0, durationMs: 0, sampleCount: 0, challengeOk: false },
    };
  }
}
