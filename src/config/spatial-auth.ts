/**
 * PINIT Spatial Auth (Phase 1) — block-level Mode A exact integrity.
 *
 * Feature-flagged: when disabled, enrollment/verify APIs no-op or 404
 * and DNA generation does not create SpatialAuthPackage rows.
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

/** Legacy packages (pipe-joined MAC / colon HKDF info) — still verifiable */
export const SPATIAL_AUTH_ALGORITHM_VERSION_V1 = 'spatial-auth-v1';

/**
 * Phase 3F hardened packages — length-prefixed binary crypto serialization.
 * New enrollments default here. Existing v1 packages remain verifiable.
 */
export const SPATIAL_AUTH_ALGORITHM_VERSION_V1_1 = 'spatial-auth-v1.1';

/** Current enrollment default */
export const SPATIAL_AUTH_ALGORITHM_VERSION = SPATIAL_AUTH_ALGORITHM_VERSION_V1_1;

export const SPATIAL_AUTH_SUPPORTED_VERSIONS = [
  SPATIAL_AUTH_ALGORITHM_VERSION_V1,
  SPATIAL_AUTH_ALGORITHM_VERSION_V1_1,
] as const;

export function isSupportedSpatialAuthVersion(version: string): boolean {
  return (SPATIAL_AUTH_SUPPORTED_VERSIONS as readonly string[]).includes(version);
}

/** Orientation / decode policy — matches DNA L1–L6 (file pixel order, no EXIF rotate) */
export const SPATIAL_ORIENTATION_POLICY = 'file-pixel-order-v1';

export const spatialAuthConfig = {
  /** Master switch — default OFF so existing DNA/vault behavior is unchanged */
  enabled: flag('SPATIAL_AUTH_ENABLED', false),

  /** Server master secret — never stored in DB or embedded in images */
  masterSecret: optional(
    'SPATIAL_AUTH_SECRET',
    optional('LSB_SIGNATURE_SECRET', 'dev_spatial_auth_secret_change_in_prod'),
  ),

  /** Key rotation id stored in packages (not the secret itself) */
  keyId: optional('SPATIAL_AUTH_KEY_ID', 'spatial-key-v1'),

  /** Primary Mode A grid (cryptographic) */
  primaryScale: intEnv('SPATIAL_AUTH_PRIMARY_SCALE', 64),

  /** Always generate/store this secondary scale when inexpensive */
  secondaryScale: intEnv('SPATIAL_AUTH_SECONDARY_SCALE', 128),

  /** Fine grid — off by default */
  fineScaleEnabled: flag('SPATIAL_AUTH_FINE_SCALE', false),
  fineScale: intEnv('SPATIAL_AUTH_FINE_SCALE_SIZE', 32),

  /** Truncated HMAC tag bytes (128-bit) */
  tagBytes: 16,

  algorithmVersion: SPATIAL_AUTH_ALGORITHM_VERSION,
  orientationPolicy: SPATIAL_ORIENTATION_POLICY,
} as const;

export function isSpatialAuthEnabled(): boolean {
  return spatialAuthConfig.enabled;
}

/** Scales to enroll for the current config */
export function spatialAuthEnrollmentScales(): number[] {
  const scales = new Set<number>();
  scales.add(spatialAuthConfig.primaryScale);
  scales.add(spatialAuthConfig.secondaryScale);
  if (spatialAuthConfig.fineScaleEnabled) {
    scales.add(spatialAuthConfig.fineScale);
  }
  return [...scales].sort((a, b) => a - b);
}
