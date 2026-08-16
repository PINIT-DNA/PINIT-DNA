/**
 * Phase 3A — Pixel HKCA config
 *
 * TAG SIZE DECISION (evaluated before implementation):
 * - 4-byte: rejected (weak truncation / birthday risk for integrity tags)
 * - 8-byte (64-bit): DEFAULT — keyed HMAC truncation is standard; forgery still
 *   requires SPATIAL_AUTH_SECRET; ~½ storage of 16-byte at 12–25 MP
 * - 16-byte (128-bit): optional via SPATIAL_PIXEL_TAG_BYTES=16 for max parity
 *   with Phase 1 block tags; ~2× blob size
 *
 * 3A: server-side 8×8 HKCA only — NO GLPM / no pixel embedding / no blue LSB.
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

/** Legacy pixel HKCA (pipe-joined MAC / colon HKDF info) */
export const SPATIAL_PIXEL_ALGORITHM_VERSION_V1 = 'spatial-pixel-auth-v1';

/** Phase 3F hardened pixel HKCA — length-prefixed binary crypto serialization */
export const SPATIAL_PIXEL_ALGORITHM_VERSION_V1_1 = 'spatial-pixel-auth-v1.1';

/** Current enrollment default */
export const SPATIAL_PIXEL_ALGORITHM_VERSION = SPATIAL_PIXEL_ALGORITHM_VERSION_V1_1;

export const SPATIAL_PIXEL_SUPPORTED_VERSIONS = [
  SPATIAL_PIXEL_ALGORITHM_VERSION_V1,
  SPATIAL_PIXEL_ALGORITHM_VERSION_V1_1,
] as const;

export function isSupportedSpatialPixelVersion(version: string): boolean {
  return (SPATIAL_PIXEL_SUPPORTED_VERSIONS as readonly string[]).includes(version);
}

export const SPATIAL_PIXEL_SCHEME = 'hkca-8';

/** Allowed truncated HMAC sizes after evaluation */
export const SPATIAL_PIXEL_ALLOWED_TAG_BYTES = [8, 16] as const;

function resolveTagBytes(): 8 | 16 {
  const n = intEnv('SPATIAL_PIXEL_TAG_BYTES', 8);
  if (n === 16) return 16;
  return 8; // default + any invalid value
}

export const spatialPixelAuthConfig = {
  /**
   * Phase 3A master switch. Requires SPATIAL_AUTH_ENABLED for enroll path.
   * Default OFF — additive.
   */
  enabled: flag('SPATIAL_PIXEL_AUTH_ENABLED', false),

  /** Same secret family as Phase 1 — never stored in DB / image */
  masterSecret: optional(
    'SPATIAL_AUTH_SECRET',
    optional('LSB_SIGNATURE_SECRET', 'dev_spatial_auth_secret_change_in_prod'),
  ),

  keyId: optional('SPATIAL_PIXEL_KEY_ID', optional('SPATIAL_AUTH_KEY_ID', 'spatial-key-v1')),

  cellSize: 8 as const,

  /** Finalized default: 8-byte tags (see header evaluation) */
  tagBytes: resolveTagBytes(),

  algorithmVersion: SPATIAL_PIXEL_ALGORITHM_VERSION,
  scheme: SPATIAL_PIXEL_SCHEME,

  /** GLPM explicitly disabled for 3A */
  glpmEnabled: false as const,
} as const;

export function isSpatialPixelAuthEnabled(): boolean {
  return spatialPixelAuthConfig.enabled;
}
