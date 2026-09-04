/**
 * Per-block HMAC-SHA256 DNA (8×8 default).
 * Secret stays server-side. Embeddings are never used as authentication.
 */

function flag(key: string, defaultValue = false): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

function intEnv(key: string, fallback: number): number {
  const n = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const BLOCK_DNA_ALGORITHM = 'HMAC-SHA256';
export const BLOCK_DNA_VERSION = 1;
export const BLOCK_DNA_FILE_ANALYSIS_KEY = 'pinitBlockDnaV1';

export const blockDnaConfig = {
  /** Independent of spatial-auth flags so investigation can always authenticate blocks. */
  enabled: flag('BLOCK_DNA_ENABLED', true),
  blockSize: intEnv('BLOCK_DNA_BLOCK_SIZE', 8),
  version: BLOCK_DNA_VERSION,
  algorithm: BLOCK_DNA_ALGORITHM,
  /** Never expose to the client. */
  secret: optional(
    'BLOCK_DNA_SECRET',
    optional('SPATIAL_AUTH_SECRET', optional('LSB_SIGNATURE_SECRET', 'dev_block_dna_secret_change_in_prod')),
  ),
  /**
   * Below this retrieval score (0–1) we refuse to pick a vault original
   * for cryptographic authentication (unrelated-image policy).
   */
  minRetrievalScore: Number.parseFloat(process.env['BLOCK_DNA_MIN_RETRIEVAL'] ?? '0.22'),
  /** JPEG: HMAC failures with small MAD on many blocks → UNKNOWN, not ORIGINAL. */
  jpegUnknownFailRate: 0.4,
  jpegMedianMadMax: 8,
  /** Packed hover payload: 16 hex chars of each HMAC (8 bytes). */
  publicDnaHexChars: 16,
} as const;

export function isBlockDnaEnabled(): boolean {
  return blockDnaConfig.enabled;
}
