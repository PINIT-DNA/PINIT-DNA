/**
 * Phase 4A — Hierarchical exact localization config (64→8→4→2→1)
 *
 * Default OFF. Does not change Phase 1/3A crypto or production claim (8x8_cell).
 */

function flag(key: string, defaultValue = false): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

/** Canonical hierarchy scales (pixels per side of full units) */
export const SPATIAL_HIERARCHY_LEVELS = [64, 8, 4, 2, 1] as const;
export type SpatialHierarchyScale = (typeof SPATIAL_HIERARCHY_LEVELS)[number];

/**
 * Production localization claim remains 8x8_cell until Phase 4B–4D validated.
 * Planned eventual claim after validation:
 */
export const SPATIAL_HIERARCHY_PRODUCTION_CLAIM = '8x8_cell' as const;
export const SPATIAL_HIERARCHY_PLANNED_CLAIM = '1x1_pixel' as const;

export const spatialHierarchyConfig = {
  /**
   * Expose hierarchy contracts / ancestry helpers in investigation payloads.
   * Does NOT enable cryptographic 4×4/2×2/1×1 authentication by itself.
   */
  enabled: flag('SPATIAL_HIERARCHY_ENABLED', false),

  /**
   * Phase 4B — lazy 4×4 cryptographic authentication under failed 8×8 cells.
   * Requires enrolled lossless reference RGB at verify time.
   * Does NOT enable 2×2 or 1×1 crypto. Does NOT change production claim.
   */
  quad4AuthEnabled: flag('SPATIAL_4X4_AUTH_ENABLED', false),

  /**
   * Phase 4C — lazy 2×2 cryptographic authentication under failed 4×4 cells.
   * Requires trusted Phase 4B result + enrolled lossless reference RGB.
   * Does NOT enable 1×1 crypto. Does NOT change production claim.
   */
  quad2AuthEnabled: flag('SPATIAL_2X2_AUTH_ENABLED', false),

  /**
   * Phase 4D — lazy 1×1 cryptographic authentication under failed 2×2 cells.
   * Requires trusted Phase 4C result + enrolled lossless reference RGB.
   * Default OFF. Does not auto-flip SPATIAL_HIERARCHY_PRODUCTION_CLAIM.
   */
  pixel1AuthEnabled: flag('SPATIAL_1X1_AUTH_ENABLED', false),

  levels: SPATIAL_HIERARCHY_LEVELS,

  /** Orientation / decode — must match Phase 1 */
  orientationPolicy: 'file-pixel-order-v1' as const,

  /**
   * Reference strategy: vault-original + lazy drill-down under failed parents.
   */
  referenceStrategy: 'vault-lossless-file-pixel-order-v1' as const,

  /**
   * Auth model: Phase 1/3A stored tags; 4×4/2×2 lazy vs vault; 1×1 enrolled dense tags (4E).
   */
  authModel: 'hybrid-lazy-vault-hmac-plus-enrolled-pixel1' as const,

  /** Phase 4B algorithm / domain version (lpbin only) */
  quad4AlgorithmVersion: 'spatial-quad4-auth-v1' as const,

  /** Truncated HMAC tag bytes for 4×4 units */
  quad4TagBytes: 8 as const,

  /** Phase 4C algorithm / domain version (lpbin only; distinct from 4×4) */
  quad2AlgorithmVersion: 'spatial-quad2-auth-v1' as const,

  /** Truncated HMAC tag bytes for 2×2 units (same size as Phase 4B) */
  quad2TagBytes: 8 as const,

  /** Phase 4D algorithm / domain version (lpbin only; distinct from 4×4/2×2) */
  pixel1AlgorithmVersion: 'spatial-pixel1-auth-v1' as const,

  /** Truncated HMAC tag bytes for 1×1 pixels (same size as Phase 4B/4C) */
  pixel1TagBytes: 8 as const,
} as const;

export function isSpatialHierarchyEnabled(): boolean {
  return flag('SPATIAL_HIERARCHY_ENABLED', false);
}

export function isSpatialQuad4AuthEnabled(): boolean {
  return flag('SPATIAL_4X4_AUTH_ENABLED', false);
}

export function isSpatialQuad2AuthEnabled(): boolean {
  return flag('SPATIAL_2X2_AUTH_ENABLED', false);
}

export function isSpatialPixel1AuthEnabled(): boolean {
  return flag('SPATIAL_1X1_AUTH_ENABLED', false);
}
