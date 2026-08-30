/**
 * Phase 3A types — 8×8 HKCA fine localization (not single-pixel identification)
 */

export type FineCellStatus = 'AUTHENTIC' | 'TAMPERED' | 'UNKNOWN';

export interface PixelCellGeom {
  cellId: number;
  cellX: number;
  cellY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelCellLeaf extends PixelCellGeom {
  tag: Buffer;
}

export interface PixelAuthPackageData {
  algorithmVersion: string;
  scheme: string;
  keyId: string;
  cellSize: number;
  tagBytes: number;
  pixelAuthBlob: Buffer;
  pixelAuthRoot: string;
  pixelRootMac: string;
}

export interface FineCellEntry {
  cellId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  status: FineCellStatus;
}

export interface FineTamperRegion {
  regionId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cells: number;
  cellIds: number[];
}

export interface FineLocalizationStats {
  cellsChecked: number;
  cellsPassed: number;
  cellsFailed: number;
  cellsUnknown: number;
  /** Diagnostic only */
  exactPassRate: number;
  /** Honest localization unit — not single-pixel */
  localizationUnitPx: number;
  tamperedAreaPixels: number;
  tamperedAreaPercentage: number;
}

/**
 * Phase 3A fine map — derived from cell HMACs.
 * Does NOT claim exact single-pixel identification.
 */
export interface FineBlockLocalization {
  derivedEvidenceOnly: true;
  algorithmVersion: string;
  scheme: string;
  cellSize: number;
  tagBytes: number;
  /** Claim level for clients/UI */
  localizationClaim: '8x8_cell';
  cells: FineCellEntry[];
  tamperedCells: FineCellEntry[];
  stats: FineLocalizationStats;
  regions: FineTamperRegion[];
  /** Optional: only cells inside Phase-2 failed 64×64 blocks when drill-down */
  drillDown: boolean;
  parentBlockIds?: number[];
  verificationMs: number;
}

export interface PixelEnrollmentResult {
  cellCount: number;
  cellSize: number;
  tagBytes: number;
  blobBytes: number;
  pixelAuthRoot: string;
  enrollmentMs: number;
  algorithmVersion: string;
  scheme: string;
}
