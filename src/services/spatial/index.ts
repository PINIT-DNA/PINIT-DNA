/**
 * PINIT Spatial Auth Module — Phase 1 (crypto) + Phase 2 (localization)
 *
 * Pure crypto/grid/localization exports are safe without DATABASE_URL.
 */

export {
  isSpatialAuthEnabled,
  spatialAuthConfig,
  spatialAuthEnrollmentScales,
  SPATIAL_AUTH_ALGORITHM_VERSION,
  SPATIAL_AUTH_ALGORITHM_VERSION_V1,
  SPATIAL_AUTH_ALGORITHM_VERSION_V1_1,
  SPATIAL_AUTH_SUPPORTED_VERSIONS,
  isSupportedSpatialAuthVersion,
  SPATIAL_ORIENTATION_POLICY,
} from '../../config/spatial-auth';
export { buildBlockGrid, extractBlockRgb } from './block-grid';
export {
  authenticateAllScales,
  authenticateBlocksForScale,
  computeBlockAuthTag,
  computeBlockContentHash,
} from './block-auth';
export { encodeBlockBlob, decodeBlockBlob } from './block-blob';
export {
  merkleRootHex,
  computeMerkleRoot,
  computeRootMac,
  verifyRootMac,
  sortLeavesDeterministic,
  hashSpatialLeaf,
} from './merkle';
export { decodeImageForSpatialAuth } from './image-decode';
export { buildSpatialAuthPackageFromRgb, resolveGlobalDnaRef } from './package-builder';
export { verifyExactSpatialAuth } from './verify-exact';
export { deriveSpatialBlockKey, deriveSpatialRootMacKey } from './key-derivation';
export {
  buildSpatialBlockLocalization,
  buildTamperMask,
  findConnectedTamperRegions,
  classifyModificationPattern,
  computeTamperStats,
  buildGridPreview,
  statusToMaskByte,
  maskByteToStatus,
} from './tamper-localize';
export {
  attachSpatialLocalizationToImageDiff,
  localizationToChangedRegions,
  fineLocalizationToChangedRegions,
  spatialLocalizationForTamperAnalysis,
  spatialHierarchySummaryForInvestigate,
  mergeSpatialVerifyIntoTamperAnalysis,
} from './integration';
export {
  buildSpatialInvestigation,
  buildFineTamperMask,
  buildSpatialOverlayDescriptor,
  drillDownBlock,
} from './investigation';
export {
  isSpatialPixelAuthEnabled,
  spatialPixelAuthConfig,
  SPATIAL_PIXEL_ALGORITHM_VERSION,
  SPATIAL_PIXEL_ALGORITHM_VERSION_V1,
  SPATIAL_PIXEL_ALGORITHM_VERSION_V1_1,
  SPATIAL_PIXEL_SUPPORTED_VERSIONS,
  isSupportedSpatialPixelVersion,
  buildPixelAuthPackageFromRgb,
  verifyPixelAuthLayer,
  buildPixelCellGrid,
  buildFineLocalization,
  encodePixelAuthBlob,
  decodePixelAuthBlob,
  computePixelCellAuthTag,
  pixelMerkleRootHex,
  computePixelRootMac,
  deriveSpatialPixelKey,
} from './pixel-auth';
export {
  buildCryptoPayload,
  buildHkdfInfo,
  encodingForSpatialAuthVersion,
  encodingForSpatialPixelVersion,
} from './crypto-encoding';
export type {
  ExactVerificationStatus,
  BlockAuthStatus,
  SpatialBlockGeom,
  SpatialBlockLeaf,
  SpatialAuthPackageData,
  TamperedBlockResult,
  ExactSpatialVerificationResult,
  SpatialEnrollmentResult,
} from './types';
export type {
  BlockMapStatus,
  BlockMapEntry,
  SpatialTamperStats,
  SpatialTamperRegion,
  SpatialModificationPattern,
  SpatialModificationPatternInfo,
  SpatialTamperMask,
  SpatialBlockLocalization,
} from './localization.types';
export type {
  FineBlockLocalization,
  FineCellEntry,
  PixelAuthPackageData,
  PixelEnrollmentResult,
} from './pixel-auth/types';
export type { PixelLayerVerifyResult, PixelVerifyStatus } from './pixel-auth/verify';
export type {
  SpatialInvestigationResult,
  SpatialHierarchicalBlock,
  SpatialInvestigationRegion,
  SpatialInvestigationStats,
  SpatialOverlayDescriptor,
  FineTamperMask,
  SpatialLocalizationClaim,
} from './investigation.types';

/** Phase 4A — hierarchy architecture (64→8→4→2→1); no fine crypto yet */
export {
  isSpatialHierarchyEnabled,
  isSpatialQuad4AuthEnabled,
  isSpatialQuad2AuthEnabled,
  isSpatialPixel1AuthEnabled,
  spatialHierarchyConfig,
  SPATIAL_HIERARCHY_LEVELS,
  SPATIAL_HIERARCHY_PRODUCTION_CLAIM,
  SPATIAL_HIERARCHY_PLANNED_CLAIM,
  buildHierarchyGrid,
  subdivideUnit,
  ancestryForPixel,
  containsRect,
  pixelInUnit,
  verifyExclusiveCoverage,
  verifyAllLevelCoverage,
  planLazyExpansion,
  estimateLazyOpsForRect,
  buildHierarchicalLocalizationContract,
  computeHierarchyUnitCounts,
  estimateMegapixelUnitCounts,
  parentScaleOf,
  childScaleOf,
  unitOrigin,
  unitIdAt,
  verifyQuad4UnderFailed8x8,
  deriveSpatialQuad4Key,
  computeQuad4AuthTag,
  quad4Unavailable,
  verifyQuad2UnderFailed4x4,
  deriveSpatialQuad2Key,
  computeQuad2AuthTag,
  quad2Unavailable,
  verifyPixel1UnderFailed2x2,
  deriveSpatialPixel1Key,
  computePixel1AuthTag,
  pixel1Unavailable,
  PIXEL1_HKDF_INFO,
  PIXEL1_MAC_DOMAIN,
  QUAD2_HKDF_INFO,
  QUAD2_MAC_DOMAIN,
  QUAD4_HKDF_INFO,
  QUAD4_MAC_DOMAIN,
  buildPixel1AuthPackageFromRgb,
  encodePixel1AuthBlob,
  decodePixel1AuthBlob,
  lookupPixel1EnrolledTag,
  computePixel1AuthRootHex,
  computePixel1RootMac,
  verifyPixel1RootMac,
  verifyPixel1BlobIntegrity,
} from './hierarchy';
export type {
  HierarchyUnit,
  HierarchyAncestry,
  HierarchicalLocalizationContract,
  HierarchyUnitCounts,
  HierarchyLevelName,
  HierarchyUnitStatus,
  Quad4LocalizationResult,
  Quad4CellResult,
  Quad4CellStatus,
  Quad2LocalizationResult,
  Quad2CellResult,
  Quad2CellStatus,
  Pixel1LocalizationResult,
  Pixel1Result,
  Pixel1Status,
  Pixel1EnrollmentPackage,
} from './hierarchy';
