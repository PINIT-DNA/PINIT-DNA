/**
 * Phase 4A — build geometric grids at hierarchy scales
 * Uses original image coordinates; edge units may be partial.
 */

import type { SpatialHierarchyScale } from '../../../config/spatial-hierarchy';
import type { HierarchyLevelName, HierarchyUnit } from './types';
import { scaleToLevelName } from './types';

export function gridDims(imageSize: number, scale: number): number {
  return Math.ceil(imageSize / scale);
}

/** Global unit id at a scale: row-major over the image */
export function unitIdAt(scale: SpatialHierarchyScale, imageWidth: number, ux: number, uy: number): number {
  const cols = gridDims(imageWidth, scale);
  return uy * cols + ux;
}

export function unitOrigin(scale: SpatialHierarchyScale, pixelX: number, pixelY: number): { x: number; y: number } {
  return {
    x: Math.floor(pixelX / scale) * scale,
    y: Math.floor(pixelY / scale) * scale,
  };
}

/**
 * Build all units of a given scale covering the image (complete coverage).
 */
export function buildHierarchyGrid(
  imageWidth: number,
  imageHeight: number,
  scale: SpatialHierarchyScale,
): HierarchyUnit[] {
  if (imageWidth < 1 || imageHeight < 1) {
    throw new Error(`Invalid image dimensions ${imageWidth}x${imageHeight}`);
  }
  if (![64, 8, 4, 2, 1].includes(scale)) {
    throw new Error(`Unsupported hierarchy scale ${scale}`);
  }

  const cols = gridDims(imageWidth, scale);
  const rows = gridDims(imageHeight, scale);
  const level = scaleToLevelName(scale);
  const parentScale = parentScaleOf(scale);
  const units: HierarchyUnit[] = [];

  for (let uy = 0; uy < rows; uy++) {
    for (let ux = 0; ux < cols; ux++) {
      const x = ux * scale;
      const y = uy * scale;
      const width = Math.min(scale, imageWidth - x);
      const height = Math.min(scale, imageHeight - y);
      const unitId = uy * cols + ux;
      let parentId: number | null = null;
      if (parentScale != null) {
        const px = Math.floor(x / parentScale);
        const py = Math.floor(y / parentScale);
        parentId = unitIdAt(parentScale, imageWidth, px, py);
      }
      units.push({
        unitId,
        scale,
        level,
        x,
        y,
        width,
        height,
        parentId,
        parentScale,
        status: 'NOT_EVALUATED',
      });
    }
  }
  return units;
}

export function parentScaleOf(scale: SpatialHierarchyScale): SpatialHierarchyScale | null {
  if (scale === 64) return null;
  if (scale === 8) return 64;
  if (scale === 4) return 8;
  if (scale === 2) return 4;
  return 2; // 1 → 2
}

export function childScaleOf(scale: SpatialHierarchyScale): SpatialHierarchyScale | null {
  if (scale === 64) return 8;
  if (scale === 8) return 4;
  if (scale === 4) return 2;
  if (scale === 2) return 1;
  return null;
}

/**
 * Subdivide one parent unit into children at childScale.
 * Children use original coordinates; partial at image/parent edges.
 */
export function subdivideUnit(
  parent: Pick<HierarchyUnit, 'x' | 'y' | 'width' | 'height' | 'unitId' | 'scale'>,
  imageWidth: number,
  imageHeight: number,
  childScale: SpatialHierarchyScale,
): HierarchyUnit[] {
  if (childScale >= parent.scale && parent.scale !== 64) {
    // 64→8 allowed even though 8<64; reject childScale > parent.scale
  }
  if (childScale > parent.scale) {
    throw new Error(`childScale ${childScale} cannot exceed parent scale ${parent.scale}`);
  }
  const x1 = parent.x + parent.width;
  const y1 = parent.y + parent.height;
  const children: HierarchyUnit[] = [];
  const level = scaleToLevelName(childScale);

  for (let y = parent.y; y < y1; y += childScale) {
    for (let x = parent.x; x < x1; x += childScale) {
      const width = Math.min(childScale, x1 - x, imageWidth - x);
      const height = Math.min(childScale, y1 - y, imageHeight - y);
      if (width < 1 || height < 1) continue;
      const ux = Math.floor(x / childScale);
      const uy = Math.floor(y / childScale);
      children.push({
        unitId: unitIdAt(childScale, imageWidth, ux, uy),
        scale: childScale,
        level,
        x,
        y,
        width,
        height,
        parentId: parent.unitId,
        parentScale: parent.scale as SpatialHierarchyScale,
        status: 'NOT_EVALUATED',
      });
    }
  }
  return children;
}

export function countUnitsAtScale(
  imageWidth: number,
  imageHeight: number,
  scale: SpatialHierarchyScale,
): number {
  return gridDims(imageWidth, scale) * gridDims(imageHeight, scale);
}

export function estimateMegapixelUnitCounts(megapixels: number): Record<HierarchyLevelName, number> {
  // Approximate square image: side = sqrt(MP * 1e6)
  const side = Math.round(Math.sqrt(megapixels * 1_000_000));
  return {
    '64x64': countUnitsAtScale(side, side, 64),
    '8x8': countUnitsAtScale(side, side, 8),
    '4x4': countUnitsAtScale(side, side, 4),
    '2x2': countUnitsAtScale(side, side, 2),
    '1x1': countUnitsAtScale(side, side, 1),
  };
}
