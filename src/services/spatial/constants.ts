/**
 * Spatial Auth Phase 1 — shared constants
 */

export const SPATIAL_BLOCK_BLOB_MAGIC = Buffer.from('SPB1');
export const SPATIAL_LEAF_PREFIX = Buffer.from('SPATIAL-LEAF-v1');
export const SPATIAL_HKDF_INFO_BLOCK = 'pinit-spatial-block-hmac-v1';
export const SPATIAL_HKDF_INFO_ROOT = 'pinit-spatial-root-mac-v1';
export const SPATIAL_TAG_BYTES = 16;
