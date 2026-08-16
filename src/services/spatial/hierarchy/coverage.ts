/**
 * Phase 4A — coverage invariants (no duplicate pixel ownership at a level)
 */

import type { SpatialHierarchyScale } from '../../../config/spatial-hierarchy';
import { buildHierarchyGrid } from './unit-grid';

export interface CoverageReport {
  scale: SpatialHierarchyScale;
  unitCount: number;
  pixelsCovered: number;
  expectedPixels: number;
  complete: boolean;
  overlaps: number;
  gaps: number;
}

/**
 * Verify every pixel belongs to exactly one unit at the given scale.
 */
export function verifyExclusiveCoverage(
  imageWidth: number,
  imageHeight: number,
  scale: SpatialHierarchyScale,
): CoverageReport {
  const units = buildHierarchyGrid(imageWidth, imageHeight, scale);
  const owner = new Int32Array(imageWidth * imageHeight).fill(-1);
  let overlaps = 0;
  let pixelsCovered = 0;

  for (const u of units) {
    for (let y = u.y; y < u.y + u.height; y++) {
      for (let x = u.x; x < u.x + u.width; x++) {
        const i = y * imageWidth + x;
        if (owner[i] !== -1) overlaps += 1;
        else {
          owner[i] = u.unitId;
          pixelsCovered += 1;
        }
      }
    }
  }

  let gaps = 0;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] === -1) gaps += 1;
  }

  const expectedPixels = imageWidth * imageHeight;
  return {
    scale,
    unitCount: units.length,
    pixelsCovered,
    expectedPixels,
    complete: gaps === 0 && overlaps === 0 && pixelsCovered === expectedPixels,
    overlaps,
    gaps,
  };
}

export function verifyAllLevelCoverage(
  imageWidth: number,
  imageHeight: number,
): CoverageReport[] {
  return ([64, 8, 4, 2, 1] as SpatialHierarchyScale[]).map((s) =>
    verifyExclusiveCoverage(imageWidth, imageHeight, s),
  );
}
