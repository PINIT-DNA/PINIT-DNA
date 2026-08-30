/**
 * Phase 4A — hierarchy types / result contracts
 * Architecture spike only — no cryptographic 4×4/2×2/1×1 verification.
 */

import type {
  SpatialHierarchyScale,
} from '../../../config/spatial-hierarchy';

export type HierarchyUnitStatus = 'AUTHENTIC' | 'TAMPERED' | 'UNKNOWN' | 'NOT_EVALUATED';

export type HierarchyLevelName = '64x64' | '8x8' | '4x4' | '2x2' | '1x1';

export function scaleToLevelName(scale: SpatialHierarchyScale): HierarchyLevelName {
  return `${scale}x${scale}` as HierarchyLevelName;
}

export function levelNameToScale(name: HierarchyLevelName): SpatialHierarchyScale {
  const n = parseInt(name.split('x')[0]!, 10);
  if (n !== 64 && n !== 8 && n !== 4 && n !== 2 && n !== 1) {
    throw new Error(`Invalid level name ${name}`);
  }
  return n;
}

/** Geometric unit at one hierarchy level (edge units may be partial) */
export interface HierarchyUnit {
  /** Stable id within (image, scale): row-major over image grid at this scale */
  unitId: number;
  scale: SpatialHierarchyScale;
  level: HierarchyLevelName;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Parent unit id at next coarser scale, or null for 64×64 */
  parentId: number | null;
  parentScale: SpatialHierarchyScale | null;
  status: HierarchyUnitStatus;
}

export interface HierarchyAncestry {
  pixel: { x: number; y: number };
  levels: {
    '64x64': HierarchyUnit;
    '8x8': HierarchyUnit;
    '4x4': HierarchyUnit;
    '2x2': HierarchyUnit;
    '1x1': HierarchyUnit;
  };
}

/**
 * Additive investigation contract for progressive drill-down.
 * productionClaim MUST remain 8x8_cell in Phase 4A.
 */
export interface HierarchicalLocalizationContract {
  /** Always true — not a trust source until crypto levels exist */
  derivedEvidenceOnly: true;
  architectureOnly: true;
  /** Current honest production claim — do not advertise 1×1 yet */
  productionClaim: '8x8_cell';
  /** Future claim after 4B–4D validation */
  plannedClaim: '1x1_pixel';
  /** Which levels have cryptographic authentication implemented */
  cryptoImplementedLevels: HierarchyLevelName[];
  /** Full canonical hierarchy supported by data model */
  canonicalLevels: HierarchyLevelName[];
  orientationPolicy: 'file-pixel-order-v1';
  imageWidth: number;
  imageHeight: number;
  /**
   * Lazy expansion plan / skeleton.
   * In 4A, statuses for 4×4/2×2/1×1 are NOT_EVALUATED (no crypto yet).
   */
  levels: Partial<Record<HierarchyLevelName, HierarchyUnit[]>>;
  /** UI drill-down contract */
  drillDown: {
    order: HierarchyLevelName[];
    description: string;
  };
  referenceStrategy: string;
  authModel: string;
  note: string;
}

/** Counts of units covering an image (edge-aware) */
export interface HierarchyUnitCounts {
  imageWidth: number;
  imageHeight: number;
  totalPixels: number;
  counts: Record<HierarchyLevelName, number>;
}
