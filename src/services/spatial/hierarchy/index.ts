/**
 * Phase 4A — hierarchical 64→8→4→2→1 architecture module
 * Phase 4B/4C add lazy 4×4 / 2×2 crypto under failed parents (additive).
 */

export {
  isSpatialHierarchyEnabled,
  isSpatialQuad4AuthEnabled,
  isSpatialQuad2AuthEnabled,
  isSpatialPixel1AuthEnabled,
  spatialHierarchyConfig,
  SPATIAL_HIERARCHY_LEVELS,
  SPATIAL_HIERARCHY_PRODUCTION_CLAIM,
  SPATIAL_HIERARCHY_PLANNED_CLAIM,
} from '../../../config/spatial-hierarchy';

export type {
  HierarchyUnit,
  HierarchyAncestry,
  HierarchicalLocalizationContract,
  HierarchyUnitCounts,
  HierarchyLevelName,
  HierarchyUnitStatus,
} from './types';
export { scaleToLevelName, levelNameToScale } from './types';

export {
  buildHierarchyGrid,
  subdivideUnit,
  parentScaleOf,
  childScaleOf,
  unitOrigin,
  unitIdAt,
  countUnitsAtScale,
  estimateMegapixelUnitCounts,
} from './unit-grid';

export {
  ancestryForPixel,
  containsRect,
  pixelInUnit,
} from './ancestry';

export {
  verifyExclusiveCoverage,
  verifyAllLevelCoverage,
} from './coverage';

export {
  planLazyExpansion,
  estimateLazyOpsForRect,
} from './lazy-plan';

export {
  buildHierarchicalLocalizationContract,
  computeHierarchyUnitCounts,
} from './contract';

export {
  verifyQuad4UnderFailed8x8,
  deriveSpatialQuad4Key,
  computeQuad4AuthTag,
  quad4Unavailable,
  QUAD4_HKDF_INFO,
  QUAD4_MAC_DOMAIN,
} from './quad4-auth';
export type {
  Quad4LocalizationResult,
  Quad4CellResult,
  Quad4CellStatus,
} from './quad4-auth';

export {
  verifyQuad2UnderFailed4x4,
  deriveSpatialQuad2Key,
  computeQuad2AuthTag,
  quad2Unavailable,
  QUAD2_HKDF_INFO,
  QUAD2_MAC_DOMAIN,
} from './quad2-auth';
export type {
  Quad2LocalizationResult,
  Quad2CellResult,
  Quad2CellStatus,
} from './quad2-auth';

export {
  verifyPixel1UnderFailed2x2,
  deriveSpatialPixel1Key,
  computePixel1AuthTag,
  pixel1Unavailable,
  PIXEL1_HKDF_INFO,
  PIXEL1_MAC_DOMAIN,
} from './pixel1-auth';
export type {
  Pixel1LocalizationResult,
  Pixel1Result,
  Pixel1Status,
} from './pixel1-auth';

export {
  encodePixel1AuthBlob,
  decodePixel1AuthBlob,
  lookupPixel1EnrolledTag,
  PIXEL1_BLOB_MAGIC,
} from './pixel1-blob';

export {
  buildPixel1AuthPackageFromRgb,
} from './pixel1-enroll';
export type { Pixel1EnrollmentPackage } from './pixel1-enroll';

export {
  computePixel1AuthRootHex,
  computePixel1RootMac,
  verifyPixel1RootMac,
  verifyPixel1BlobIntegrity,
} from './pixel1-merkle';
