/**
 * Phase 3A — Hierarchical Keyed Cell Authentication (HKCA)
 * Server-side only — no GLPM / no pixel embedding.
 */

export {
  SPATIAL_PIXEL_ALGORITHM_VERSION,
  SPATIAL_PIXEL_ALGORITHM_VERSION_V1,
  SPATIAL_PIXEL_ALGORITHM_VERSION_V1_1,
  SPATIAL_PIXEL_SUPPORTED_VERSIONS,
  isSupportedSpatialPixelVersion,
  SPATIAL_PIXEL_SCHEME,
  spatialPixelAuthConfig,
  isSpatialPixelAuthEnabled,
} from '../../../config/spatial-pixel-auth';
export { buildPixelCellGrid, extractCellRgb } from './cell-grid';
export { authenticateAllPixelCells, computePixelCellAuthTag } from './cell-auth';
export { encodePixelAuthBlob, decodePixelAuthBlob } from './pixel-blob';
export { pixelMerkleRootHex, computePixelRootMac, verifyPixelRootMac } from './pixel-merkle';
export { buildPixelAuthPackageFromRgb } from './package-builder';
export { verifyPixelAuthLayer } from './verify';
export { deriveSpatialPixelKey, deriveSpatialPixelRootMacKey } from './key-derivation';
export {
  buildFineLocalization,
  findConnectedFineRegions,
  cellIdsOverlappingRect,
} from './fine-map';
export type * from './types';
export type { PixelLayerVerifyResult, PixelVerifyStatus } from './verify';
