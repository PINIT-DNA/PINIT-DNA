/**
 * Real-world-scale monitoring for the comparison engine's per-layer scores
 * (item 4.6 of the 2026-09-23 security/honesty pass).
 *
 * L2 (Structural) and L4 (Semantic) were audited earlier this session and
 * found to genuinely work as documented (L2 confirmed true, L4's overclaim
 * corrected to its real limits) — but only against synthetic test images.
 * "Genuinely verified" and "confirmed at production scale" are different
 * claims, and only the second one needs real, ongoing data to check.
 * Nothing before this logged layer-by-layer scores anywhere queryable —
 * investigation reports only ever reached the client (localStorage) or a
 * plain summary string. This is the logging half; scripts/report-layer-score-monitoring.ts
 * is the read half.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface LayerScoreForMonitoring {
  layer: number;
  name: string;
  similarityPercent: number;
  matched: boolean;
  skipped?: boolean;
}

/**
 * Fire-and-forget: never lets a monitoring-write failure affect the
 * investigation it's observing. Logs every layer, not just L2/L4 — cheap to
 * keep everything, and having L1/L3's numbers alongside gives L2/L4's
 * numbers real context (e.g. "was this actually a strong match at all")
 * without a second query later.
 */
export function recordLayerScores(params: {
  investigationId?: string | null;
  dnaRecordId?: string | null;
  layers: LayerScoreForMonitoring[];
  context?: string;
}): void {
  if (!params.layers.length) return;
  void prisma.layerScoreObservation.createMany({
    data: params.layers.map((l) => ({
      investigationId: params.investigationId ?? null,
      dnaRecordId: params.dnaRecordId ?? null,
      layer: l.layer,
      layerName: l.name,
      similarityScore: l.skipped ? 0 : l.similarityPercent / 100,
      matched: l.skipped ? false : l.matched,
      skipped: l.skipped ?? false,
      context: params.context ?? 'investigation',
    })),
  }).catch((err) => {
    logger.warn('[LayerScoreMonitoring] write failed (non-fatal)', { error: String(err) });
  });
}
