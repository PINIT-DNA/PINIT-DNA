/**
 * PINIT Local DNA Index — patch-level fingerprint configuration.
 * Enables identification from partial crops, screenshots, and edited fragments.
 */
function flag(key: string, defaultValue = true): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

function intEnv(key: string, fallback: number): number {
  const n = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function scalesFromEnv(): number[] {
  const raw = (process.env['PINIT_LOCAL_DNA_SCALES'] ?? '16,32,64,128').trim();
  const parsed = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 8 && n <= 256);
  return parsed.length ? parsed : [16, 32, 64, 128];
}

export const localDnaConfig = {
  enabled: flag('PINIT_LOCAL_DNA_ENABLED', true),
  /** Primary grid cell size (legacy single-scale default) */
  patchSize: intEnv('PINIT_LOCAL_DNA_PATCH_SIZE', 32),
  /** Multi-scale patch sizes for enterprise retrieval */
  patchScales: scalesFromEnv(),
  /** Max patches per image per scale (caps very large images) */
  maxPatchesPerImage: intEnv('PINIT_LOCAL_DNA_MAX_PATCHES', 2500),
  /** Hamming distance threshold on 64-bit patch pHash */
  patchHammingThreshold: intEnv('PINIT_LOCAL_DNA_HAMMING_THRESHOLD', 14),
  /** Min probe→vault patch match ratio (10% visible fragment) */
  minMatchRatio: parseFloat(process.env['PINIT_LOCAL_DNA_MIN_MATCH_RATIO'] ?? '0.08'),
  /** Min absolute patch matches for a valid hit */
  minPatchMatches: intEnv('PINIT_LOCAL_DNA_MIN_PATCH_MATCHES', 4),
  /** Min spatial consistency (translation agreement across votes) */
  minSpatialConsistency: parseFloat(process.env['PINIT_LOCAL_DNA_MIN_SPATIAL'] ?? '0.38'),
  /** Composite score to promote local-DNA match to identity */
  identifyCompositeThreshold: intEnv('PINIT_LOCAL_DNA_IDENTIFY_THRESHOLD', 65),
  /** Top vault candidates to ORB-refine after patch voting */
  orbRefineTopK: intEnv('PINIT_LOCAL_DNA_ORB_TOP_K', 5),
  /** Weight per scale in multi-scale voting */
  scaleWeights: { 16: 0.15, 32: 0.30, 64: 0.30, 128: 0.25 } as Record<number, number>,
} as const;
