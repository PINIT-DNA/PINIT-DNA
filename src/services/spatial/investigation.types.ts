/**
 * Spatial Auth Phase 3C — investigation / visualization types
 *
 * Visualization layer only. Does NOT recalculate authentication.
 * Trust hierarchy: Phase 1 → Phase 2 → Phase 3A → Phase 3C (derived display).
 */

import type { BlockMapEntry, SpatialModificationPatternInfo } from './localization.types';
import type { FineCellEntry, FineCellStatus } from './pixel-auth/types';

/** Honest claim — never single-pixel cryptographic ID */
export type SpatialLocalizationClaim = '8x8_cell';

/** Compact fine mask — cell-accurate, no blur/interpolation */
export interface FineTamperMask {
  format: 'cell-byte-v1';
  /** 0 = AUTHENTIC, 1 = TAMPERED, 2 = UNKNOWN */
  encoding: { AUTHENTIC: 0; TAMPERED: 1; UNKNOWN: 2 };
  imageWidth: number;
  imageHeight: number;
  cellSize: number;
  gridCols: number;
  gridRows: number;
  cellCount: number;
  /** Row-major bytes, one per cellId */
  dataBase64: string;
  byteLength: number;
}

/**
 * Overlay descriptor for clients — presentation only.
 * Does not alter the original image; coordinates are original image pixels.
 */
export interface SpatialOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
  status: FineCellStatus | 'AUTHENTIC' | 'TAMPERED' | 'UNKNOWN';
  /** Optional ids for drill-down */
  blockId?: number;
  cellId?: number;
}

export interface SpatialOverlayDescriptor {
  format: 'spatial-overlay-rects-v1';
  visualizationOnly: true;
  imageWidth: number;
  imageHeight: number;
  localizationClaim: SpatialLocalizationClaim;
  /** Coarse 64×64 tampered rects */
  coarseRects: SpatialOverlayRect[];
  /** Fine 8×8 tampered (+ optional unknown) rects — authentic omitted for size */
  fineRects: SpatialOverlayRect[];
  /** Presentation colors (UI may override) */
  colors: {
    AUTHENTIC: string;
    TAMPERED: string;
    UNKNOWN: string;
  };
  note: string;
}

export interface SpatialInvestigationStats {
  imageWidth: number;
  imageHeight: number;
  totalPixels: number;
  total64x64Blocks: number;
  tampered64x64Blocks: number;
  total8x8Cells: number;
  tampered8x8Cells: number;
  tamperedAreaPixels: number;
  tamperedAreaPercentage: number;
  numberOfRegions: number;
  largestRegion: {
    regionId: number;
    width: number;
    height: number;
    blocks: number;
    cells: number;
    areaPixels: number;
  } | null;
  localizationClaim: SpatialLocalizationClaim;
}

/** Phase 2 region enriched with Phase 3 cell counts (no new region algorithm) */
export interface SpatialInvestigationRegion {
  regionId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Failed 64×64 blocks in this Phase-2 region */
  tampered64x64Blocks: number;
  blockIds: number[];
  /** Failed 8×8 cells overlapping this region’s blocks */
  tampered8x8Cells: number;
  cellIds: number[];
  affectedAreaPixels: number;
  affectedAreaPercentage: number;
}

/** Hierarchical: IMAGE → 64×64 block → 8×8 cells */
export interface SpatialHierarchicalBlock {
  blockId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  status: 'AUTHENTIC' | 'TAMPERED' | 'UNKNOWN';
  scale: number;
  fineLocalization: {
    cellSize: number;
    localizationClaim: SpatialLocalizationClaim;
    /** All cells geometrically inside this block (for drill-down grid) */
    cells: FineCellEntry[];
    tamperedCells: FineCellEntry[];
    gridCols: number;
    gridRows: number;
  } | null;
}

/**
 * Multi-scale view support (64 and 8 now; architecture allows future 4×4).
 * Do not implement 4×4 in Phase 3C.
 */
export interface SpatialMultiScaleView {
  availableScales: number[];
  overviewScale: number;
  fineScale: number;
  /** Reserved for future smaller scales (e.g. 4) — empty in 3C */
  futureScalesReserved: number[];
}

export interface SpatialInvestigationResult {
  /** Always true — not a trust source */
  derivedEvidenceOnly: true;
  visualizationOnly: true;
  /** False when package/pixel invalid — clients must not show trusted overlays */
  trusted: boolean;
  localizationClaim: SpatialLocalizationClaim;
  claimDisclaimer: string;
  trustNote: string;
  verificationStatus: string;
  multiScale: SpatialMultiScaleView;
  stats: SpatialInvestigationStats | null;
  /** Overview: Phase-2 blocks (reference; not duplicated crypto) */
  overviewBlocks: BlockMapEntry[];
  /** Drill-down hierarchy — TAMPERED blocks always include fine cells when trusted */
  hierarchicalBlocks: SpatialHierarchicalBlock[];
  /** Phase-2 regions + Phase-3 cell enrichment */
  regions: SpatialInvestigationRegion[];
  pattern: SpatialModificationPatternInfo | null;
  /** Compact cell mask when fine layer trusted */
  fineMask: FineTamperMask | null;
  /** Presentation overlay descriptor */
  overlay: SpatialOverlayDescriptor | null;
  /** Why untrusted / empty */
  unavailableReason?: string;
  /** Phase 3C timing (not crypto) */
  investigationMs: number;
}
