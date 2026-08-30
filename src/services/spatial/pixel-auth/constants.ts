/**
 * Phase 3A — Hierarchical Keyed Cell Authentication (HKCA) constants
 */

export const PIXEL_BLOB_MAGIC = Buffer.from('SPX1');
export const PIXEL_LEAF_PREFIX = Buffer.from('SPATIAL-PIXEL-LEAF-v1');
export const PIXEL_HKDF_INFO = 'pinit-spatial-pixel-hmac-v1';
export const PIXEL_ROOT_HKDF_INFO = 'pinit-spatial-pixel-root-mac-v1';
export const PIXEL_CELL_SIZE = 8;
