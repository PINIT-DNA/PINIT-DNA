/**
 * Phase 4A — pixel ancestry through 64→8→4→2→1
 */

import type { SpatialHierarchyScale } from '../../../config/spatial-hierarchy';
import type { HierarchyAncestry, HierarchyUnit } from './types';
import { scaleToLevelName } from './types';
import { parentScaleOf, unitIdAt, unitOrigin } from './unit-grid';

function makeUnit(
  scale: SpatialHierarchyScale,
  imageWidth: number,
  imageHeight: number,
  pixelX: number,
  pixelY: number,
): HierarchyUnit {
  const { x, y } = unitOrigin(scale, pixelX, pixelY);
  const width = Math.min(scale, imageWidth - x);
  const height = Math.min(scale, imageHeight - y);
  const ux = Math.floor(x / scale);
  const uy = Math.floor(y / scale);
  const parentScale = parentScaleOf(scale);
  let parentId: number | null = null;
  if (parentScale != null) {
    const po = unitOrigin(parentScale, pixelX, pixelY);
    parentId = unitIdAt(
      parentScale,
      imageWidth,
      Math.floor(po.x / parentScale),
      Math.floor(po.y / parentScale),
    );
  }
  return {
    unitId: unitIdAt(scale, imageWidth, ux, uy),
    scale,
    level: scaleToLevelName(scale),
    x,
    y,
    width,
    height,
    parentId,
    parentScale,
    status: 'NOT_EVALUATED',
  };
}

/**
 * Full ancestry for one pixel. Throws if out of bounds.
 */
export function ancestryForPixel(
  imageWidth: number,
  imageHeight: number,
  pixelX: number,
  pixelY: number,
): HierarchyAncestry {
  if (
    !Number.isInteger(pixelX) ||
    !Number.isInteger(pixelY) ||
    pixelX < 0 ||
    pixelY < 0 ||
    pixelX >= imageWidth ||
    pixelY >= imageHeight
  ) {
    throw new Error(
      `Pixel (${pixelX},${pixelY}) out of bounds for ${imageWidth}x${imageHeight}`,
    );
  }

  return {
    pixel: { x: pixelX, y: pixelY },
    levels: {
      '64x64': makeUnit(64, imageWidth, imageHeight, pixelX, pixelY),
      '8x8': makeUnit(8, imageWidth, imageHeight, pixelX, pixelY),
      '4x4': makeUnit(4, imageWidth, imageHeight, pixelX, pixelY),
      '2x2': makeUnit(2, imageWidth, imageHeight, pixelX, pixelY),
      '1x1': makeUnit(1, imageWidth, imageHeight, pixelX, pixelY),
    },
  };
}

/** True if child rectangle is fully inside parent rectangle */
export function containsRect(
  parent: { x: number; y: number; width: number; height: number },
  child: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.width <= parent.x + parent.width &&
    child.y + child.height <= parent.y + parent.height
  );
}

export function pixelInUnit(
  unit: { x: number; y: number; width: number; height: number },
  px: number,
  py: number,
): boolean {
  return px >= unit.x && py >= unit.y && px < unit.x + unit.width && py < unit.y + unit.height;
}
