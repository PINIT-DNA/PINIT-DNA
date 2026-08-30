/**
 * Spatial Auth Phase 2 — block-level tamper localization types
 *
 * Trust hierarchy unchanged: secret → HMAC → Merkle → root MAC → package.
 * Tamper maps are derived evidence only — not a new trust source.
 */

/** Phase 2 deterministic block map status (primary scale) */
export type BlockMapStatus = 'AUTHENTIC' | 'TAMPERED' | 'UNKNOWN';

export interface BlockMapEntry {
  blockId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  status: BlockMapStatus;
  scale: number;
}

export interface SpatialTamperStats {
  blocksChecked: number;
  blocksPassed: number;
  blocksFailed: number;
  blocksUnknown: number;
  /** Diagnostic only — never proof of authenticity */
  exactPassRate: number;
  tamperedAreaPixels: number;
  tamperedAreaPercentage: number;
}

export interface SpatialTamperRegion {
  regionId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  blocks: number;
  blockIds: number[];
}

/**
 * Coarse pattern hint for later classifiers — NOT an edit-operation claim.
 */
export type SpatialModificationPattern =
  | 'NONE'
  | 'LOCAL_MODIFICATION'
  | 'MULTIPLE_LOCAL_MODIFICATIONS'
  | 'LARGE_MODIFICATION'
  | 'GLOBAL_MODIFICATION';

export interface SpatialModificationPatternInfo {
  pattern: SpatialModificationPattern;
  regionCount: number;
  /** Human-readable summary without claiming exact edit type */
  summary: string;
}

/** Compact forensic mask — block-accurate, no blur/interpolation */
export interface SpatialTamperMask {
  format: 'block-byte-v1';
  /** 0 = AUTHENTIC, 1 = TAMPERED, 2 = UNKNOWN */
  encoding: { AUTHENTIC: 0; TAMPERED: 1; UNKNOWN: 2 };
  imageWidth: number;
  imageHeight: number;
  scale: number;
  gridCols: number;
  gridRows: number;
  blockCount: number;
  /** Row-major bytes, one per block */
  dataBase64: string;
  byteLength: number;
}

/**
 * Phase 2 localization payload attached to Mode A results when crypto is trusted.
 * Absent / null when package invalid or dimensions mismatch.
 */
export interface SpatialBlockLocalization {
  /** Derived evidence disclaimer */
  derivedEvidenceOnly: true;
  primaryScale: number;
  /** Every primary-scale block with AUTHENTIC | TAMPERED | UNKNOWN */
  blocks: BlockMapEntry[];
  /** Failed blocks only (coordinates for UI) */
  tamperedBlocks: BlockMapEntry[];
  stats: SpatialTamperStats;
  regions: SpatialTamperRegion[];
  pattern: SpatialModificationPatternInfo;
  mask: SpatialTamperMask;
  /** Optional ASCII preview (debug / docs) */
  gridPreview?: string;
  maskGenerationMs: number;
  regionAnalysisMs: number;
}
