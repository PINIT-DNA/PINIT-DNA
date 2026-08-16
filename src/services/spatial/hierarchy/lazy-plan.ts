/**
 * Phase 4A — lazy hierarchical expansion plan (no crypto)
 *
 * Given failed units at a coarse level, plan which children to evaluate next.
 */

import type { HierarchyLevelName, HierarchyUnit } from './types';
import { levelNameToScale } from './types';
import { childScaleOf, subdivideUnit } from './unit-grid';

export interface LazyExpansionStep {
  fromLevel: HierarchyLevelName;
  toLevel: HierarchyLevelName;
  parentsEvaluated: number;
  childrenToEvaluate: HierarchyUnit[];
}

/**
 * Expand only TAMPERED (or provided) parent units into children.
 * Used by future 4B+ verify; 4A validates the expansion geometry only.
 */
export function planLazyExpansion(params: {
  imageWidth: number;
  imageHeight: number;
  fromLevel: HierarchyLevelName;
  failedParents: Array<Pick<HierarchyUnit, 'x' | 'y' | 'width' | 'height' | 'unitId' | 'scale'>>;
}): LazyExpansionStep {
  const fromScale = levelNameToScale(params.fromLevel);
  const toScale = childScaleOf(fromScale);
  if (toScale == null) {
    throw new Error(`No child level below ${params.fromLevel}`);
  }
  const toLevel = `${toScale}x${toScale}` as HierarchyLevelName;
  const children: HierarchyUnit[] = [];
  for (const p of params.failedParents) {
    children.push(
      ...subdivideUnit(p, params.imageWidth, params.imageHeight, toScale),
    );
  }
  return {
    fromLevel: params.fromLevel,
    toLevel,
    parentsEvaluated: params.failedParents.length,
    childrenToEvaluate: children,
  };
}

/**
 * Theoretical ops for a contiguous modified rect under lazy expansion.
 * Counts units that intersect the rect at each level (geometry only).
 */
export function estimateLazyOpsForRect(params: {
  imageWidth: number;
  imageHeight: number;
  rx: number;
  ry: number;
  rw: number;
  rh: number;
}): Record<HierarchyLevelName, number> {
  const counts: Record<HierarchyLevelName, number> = {
    '64x64': 0,
    '8x8': 0,
    '4x4': 0,
    '2x2': 0,
    '1x1': 0,
  };
  for (const scale of [64, 8, 4, 2, 1] as const) {
    const x0 = Math.floor(params.rx / scale) * scale;
    const y0 = Math.floor(params.ry / scale) * scale;
    const x1 = params.rx + params.rw;
    const y1 = params.ry + params.rh;
    let n = 0;
    for (let y = y0; y < y1; y += scale) {
      for (let x = x0; x < x1; x += scale) {
        if (x >= params.imageWidth || y >= params.imageHeight) continue;
        n += 1;
      }
    }
    counts[`${scale}x${scale}` as HierarchyLevelName] = n;
  }
  return counts;
}
