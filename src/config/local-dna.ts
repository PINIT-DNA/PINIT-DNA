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

export const localDnaConfig = {
  enabled: flag('PINIT_LOCAL_DNA_ENABLED', true),
  /** Grid cell size in pixels */
  patchSize: intEnv('PINIT_LOCAL_DNA_PATCH_SIZE', 32),
  /** Max patches per image (caps very large images) */
  maxPatchesPerImage: intEnv('PINIT_LOCAL_DNA_MAX_PATCHES', 2500),
  /** Hamming distance threshold on 64-bit patch pHash */
  patchHammingThreshold: intEnv('PINIT_LOCAL_DNA_HAMMING_THRESHOLD', 12),
  /** Min probe→vault patch match ratio to count as fragment hit (10% = crop recovery) */
  minMatchRatio: parseFloat(process.env['PINIT_LOCAL_DNA_MIN_MATCH_RATIO'] ?? '0.08'),
  /** Min absolute patch matches for a valid hit */
  minPatchMatches: intEnv('PINIT_LOCAL_DNA_MIN_PATCH_MATCHES', 6),
  /** Min spatial consistency (same crop offset across matches) */
  minSpatialConsistency: parseFloat(process.env['PINIT_LOCAL_DNA_MIN_SPATIAL'] ?? '0.45'),
  /** Composite score to promote local-DNA match to identity */
  identifyCompositeThreshold: intEnv('PINIT_LOCAL_DNA_IDENTIFY_THRESHOLD', 72),
  /** Top vault candidates to ORB-refine after patch voting */
  orbRefineTopK: intEnv('PINIT_LOCAL_DNA_ORB_TOP_K', 3),
} as const;
