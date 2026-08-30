/**
 * Phase 4A — build hierarchical localization contract (architecture spike)
 * Does NOT perform 4×4/2×2/1×1 cryptography.
 * productionClaim remains 8x8_cell.
 */

import {
  isSpatialHierarchyEnabled,
  spatialHierarchyConfig,
  SPATIAL_HIERARCHY_PRODUCTION_CLAIM,
  SPATIAL_HIERARCHY_PLANNED_CLAIM,
} from '../../../config/spatial-hierarchy';
import type { HierarchicalLocalizationContract, HierarchyUnitCounts } from './types';
import { buildHierarchyGrid, countUnitsAtScale, estimateMegapixelUnitCounts } from './unit-grid';

/**
 * When flag OFF → null (callers must not treat hierarchy as active).
 * When flag ON → architecture contract with NOT_EVALUATED fine levels.
 */
export function buildHierarchicalLocalizationContract(params: {
  imageWidth: number;
  imageHeight: number;
  /** Optional: include skeleton grids (can be large — default false) */
  includeFullGrids?: boolean;
}): HierarchicalLocalizationContract | null {
  if (!isSpatialHierarchyEnabled()) return null;
  if (params.imageWidth < 1 || params.imageHeight < 1) {
    throw new Error(`Invalid dimensions ${params.imageWidth}x${params.imageHeight}`);
  }

  const levels: HierarchicalLocalizationContract['levels'] = {};
  if (params.includeFullGrids) {
    levels['64x64'] = buildHierarchyGrid(params.imageWidth, params.imageHeight, 64);
    levels['8x8'] = buildHierarchyGrid(params.imageWidth, params.imageHeight, 8);
    levels['4x4'] = buildHierarchyGrid(params.imageWidth, params.imageHeight, 4);
    levels['2x2'] = buildHierarchyGrid(params.imageWidth, params.imageHeight, 2);
    levels['1x1'] = buildHierarchyGrid(params.imageWidth, params.imageHeight, 1);
  }

  return {
    derivedEvidenceOnly: true,
    architectureOnly: true,
    productionClaim: SPATIAL_HIERARCHY_PRODUCTION_CLAIM,
    plannedClaim: SPATIAL_HIERARCHY_PLANNED_CLAIM,
    cryptoImplementedLevels: ['64x64', '8x8'],
    canonicalLevels: ['64x64', '8x8', '4x4', '2x2', '1x1'],
    orientationPolicy: 'file-pixel-order-v1',
    imageWidth: params.imageWidth,
    imageHeight: params.imageHeight,
    levels,
    drillDown: {
      order: ['64x64', '8x8', '4x4', '2x2', '1x1'],
      description:
        'Progressive UI: overview 64→ select block → 8×8 → 4×4 → 2×2 → 1×1 pixels. ' +
        'Phase 4A provides the data contract only; crypto below 8×8 begins in 4B.',
    },
    referenceStrategy: spatialHierarchyConfig.referenceStrategy,
    authModel: spatialHierarchyConfig.authModel,
    note:
      'Phase 4A architecture spike. productionClaim=8x8_cell. ' +
      'Do not advertise 1x1_pixel until Phase 4B–4D validated.',
  };
}

export function computeHierarchyUnitCounts(
  imageWidth: number,
  imageHeight: number,
): HierarchyUnitCounts {
  return {
    imageWidth,
    imageHeight,
    totalPixels: imageWidth * imageHeight,
    counts: {
      '64x64': countUnitsAtScale(imageWidth, imageHeight, 64),
      '8x8': countUnitsAtScale(imageWidth, imageHeight, 8),
      '4x4': countUnitsAtScale(imageWidth, imageHeight, 4),
      '2x2': countUnitsAtScale(imageWidth, imageHeight, 2),
      '1x1': countUnitsAtScale(imageWidth, imageHeight, 1),
    },
  };
}

export { estimateMegapixelUnitCounts };
