/**
 * Unified Investigation performance tuning — two-stage retrieval + parallelism.
 */
function intEnv(key: string, fallback: number): number {
  const n = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function flag(key: string, defaultValue = true): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

function scalesFromEnv(key: string, fallback: number[]): number[] {
  const raw = (process.env[key] ?? '').trim();
  if (!raw) return fallback;
  const parsed = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 8 && n <= 256);
  return parsed.length ? parsed : fallback;
}

export const investigationPerformanceConfig = {
  /** Stage-1 fast filter: max vault candidates passed to heavy retrieval */
  candidatePoolSize: intEnv('PINIT_INVESTIGATION_CANDIDATE_POOL', 15),
  /** When watermark/token already found vault — cap stage-2 pool */
  candidatePoolWithIdentity: intEnv('PINIT_INVESTIGATION_IDENTITY_POOL', 5),
  candidatePoolMin: 10,
  candidatePoolMax: 50,
  /** ORB refine on top-K of filtered pool only */
  orbRefineTopK: intEnv('PINIT_INVESTIGATION_ORB_TOP_K', 3),
  /** 15-layer deep compare cap */
  deepCompareTopN: intEnv('PINIT_INVESTIGATION_DEEP_COMPARE_TOP_N', 1),
  /** Max forensic variants for investigation local-DNA probes */
  maxInvestigationProbes: intEnv('PINIT_INVESTIGATION_MAX_PROBES', 1),
  /** Skip slow ORB vault downloads in investigation (patch + vector scores suffice) */
  skipOrbInInvestigation: flag('PINIT_INVESTIGATION_SKIP_ORB', true),
  /** Skip local patch search when watermark/manifest already identified vault */
  skipLocalDnaWhenWatermark: flag('PINIT_INVESTIGATION_SKIP_LOCAL_DNA_WATERMARK', true),
  /** Skip second-pass vector ORB when identity anchor present */
  skipVectorOrbWhenWatermark: flag('PINIT_INVESTIGATION_SKIP_VECTOR_ORB_WATERMARK', true),
  /** OCR on tampered screenshots is slow — vault patch DNA handles identification */
  skipInvestigationOcr: flag('PINIT_INVESTIGATION_SKIP_OCR', true),
  /** Per-signal caps during parallel identity recovery */
  watermarkTimeoutMs: intEnv('PINIT_INVESTIGATION_WATERMARK_TIMEOUT_MS', 5_000),
  embeddingTimeoutMs: intEnv('PINIT_INVESTIGATION_EMBEDDING_TIMEOUT_MS', 5_000),
  /** Local patch search time budget (tampered / compressed probes) */
  localDnaTimeoutMs: intEnv('PINIT_INVESTIGATION_LOCAL_DNA_TIMEOUT_MS', 35_000),
  deepCompareTimeoutMs: intEnv('PINIT_INVESTIGATION_DEEP_COMPARE_TIMEOUT_MS', 45_000),
  /** Fewer patch scales in investigation (32+64 vs 16+32+64+128) */
  investigationPatchScales: scalesFromEnv('PINIT_INVESTIGATION_PATCH_SCALES', [32, 64]),
  cacheTtlMs: intEnv('PINIT_INVESTIGATION_CACHE_TTL_MS', 900_000),
} as const;

export function clampCandidatePool(size?: number): number {
  const n = size ?? investigationPerformanceConfig.candidatePoolSize;
  return Math.max(
    investigationPerformanceConfig.candidatePoolMin,
    Math.min(investigationPerformanceConfig.candidatePoolMax, n),
  );
}
