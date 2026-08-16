/**
 * Spatial Auth Phase 1+2 — public types
 */

import type { SpatialBlockLocalization } from './localization.types';
import type { FineBlockLocalization, PixelEnrollmentResult } from './pixel-auth/types';
import type { PixelLayerVerifyResult } from './pixel-auth/verify';
import type { SpatialInvestigationResult } from './investigation.types';
import type { Quad4LocalizationResult } from './hierarchy/quad4-auth';
import type { Quad2LocalizationResult } from './hierarchy/quad2-auth';
import type { Pixel1LocalizationResult } from './hierarchy/pixel1-auth';

export type ExactVerificationStatus =
  | 'MATCH'
  | 'TAMPERED'
  | 'DIMENSION_MISMATCH'
  | 'INVALID_AUTH_PACKAGE'
  | 'UNSUPPORTED_VERSION'
  | 'ERROR';

/** @deprecated Prefer BlockMapStatus from localization.types */
export type BlockAuthStatus = 'SAFE' | 'TAMPERED' | 'AUTHENTIC' | 'UNKNOWN';

export interface SpatialBlockGeom {
  blockId: number;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialBlockLeaf extends SpatialBlockGeom {
  /** Truncated HMAC-SHA256 tag (16 bytes) */
  tag: Buffer;
}

export interface SpatialAuthPackageData {
  dnaRecordId: string;
  ownerUserId: string;
  width: number;
  height: number;
  orientationPolicy: string;
  globalDnaRef: string;
  keyId: string;
  algorithmVersion: string;
  primaryScale: number;
  scales: number[];
  merkleRoot: string;
  rootMac: string;
  blockBlob: Buffer;
  createdAt?: Date;
  updatedAt?: Date;
  /** Phase 3A — optional HKCA pixel layer (server-side blob; no GLPM) */
  pixelAlgoVersion?: string | null;
  pixelScheme?: string | null;
  pixelKeyId?: string | null;
  pixelCellSize?: number | null;
  pixelTagBytes?: number | null;
  pixelAuthBlob?: Buffer | null;
  pixelAuthRoot?: string | null;
  pixelRootMac?: string | null;
  /** Phase 4E — dense enrolled 1×1 tag blob (SP1T); nullable = no 1×1 crypto package */
  pixel1AlgoVersion?: string | null;
  pixel1KeyId?: string | null;
  pixel1TagBytes?: number | null;
  pixel1AuthBlob?: Buffer | null;
  pixel1AuthRoot?: string | null;
  pixel1RootMac?: string | null;
}

export interface TamperedBlockResult {
  blockId: number;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Phase 1 used SAFE|TAMPERED; Phase 2 map uses AUTHENTIC|TAMPERED|UNKNOWN */
  status: BlockAuthStatus;
}

export interface ExactSpatialVerificationResult {
  verificationMode: 'EXACT';
  status: ExactVerificationStatus;
  matched: boolean;
  tampered: boolean;
  dnaRecordId: string;
  algorithmVersion: string;
  orientationPolicy: string;
  width: number;
  height: number;
  primaryScale: number;
  blocksChecked: number;
  blocksPassed: number;
  blocksFailed: number;
  /** Phase 2 — blocks that could not be evaluated (0 when map trusted) */
  blocksUnknown?: number;
  merkleRootMatch: boolean;
  rootMacValid: boolean;
  packageIntegrityValid: boolean;
  /** Phase 1: failed blocks only (status TAMPERED) */
  tamperedBlocks: TamperedBlockResult[];
  /** Diagnostic only — never proof of authenticity */
  exactPassRate: number;
  /**
   * Phase 2 localization — present only when package crypto is trusted
   * and geometry matches (MATCH or TAMPERED). Null for INVALID / DIMENSION_MISMATCH / ERROR.
   */
  localization?: SpatialBlockLocalization | null;
  /**
   * Phase 3A — fine 8×8 cell localization (derived from HKCA).
   * Claims 8×8 localization only — NOT exact single-pixel identification.
   * Null when pixel layer absent/invalid or geometry mismatch.
   */
  fineLocalization?: FineBlockLocalization | null;
  /** Phase 3A pixel-layer verify summary */
  pixelLayer?: PixelLayerVerifyResult | null;
  /**
   * Phase 3C — hierarchical investigation / overlay (visualization only).
   * Built from Phase 2 + 3A results; never a cryptographic trust source.
   */
  investigation?: SpatialInvestigationResult | null;
  /**
   * Phase 4B — lazy 4×4 localization under failed 8×8 cells.
   * Internal unit 4x4_cell; productionClaim remains 8x8_cell.
   * Null when disabled, untrusted, or reference unavailable.
   */
  quad4Localization?: Quad4LocalizationResult | null;
  /**
   * Phase 4C — lazy 2×2 localization under failed 4×4 cells.
   * Internal unit 2x2_cell; productionClaim remains 8x8_cell.
   * Null when disabled, parent 4×4 untrusted, or reference unavailable.
   */
  quad2Localization?: Quad2LocalizationResult | null;
  /**
   * Phase 4D — lazy 1×1 localization under failed 2×2 cells.
   * localizationClaim 1x1_pixel when trusted; null when disabled/untrusted.
   */
  pixel1Localization?: Pixel1LocalizationResult | null;
  detail?: string;
  enrollmentMs?: number;
  verificationMs: number;
  /** Phase 2 timing (included in verificationMs) */
  localizationMs?: number;
  /** Phase 3A timing */
  pixelVerificationMs?: number;
  /** Phase 4B timing */
  quad4VerificationMs?: number;
  /** Phase 4C timing */
  quad2VerificationMs?: number;
  /** Phase 4D timing */
  pixel1VerificationMs?: number;
}

export interface SpatialEnrollmentResult {
  dnaRecordId: string;
  width: number;
  height: number;
  primaryScale: number;
  scales: number[];
  blockCount: number;
  merkleRoot: string;
  packageBytes: number;
  enrollmentMs: number;
  algorithmVersion: string;
  keyId: string;
  /** Phase 3A enrollment summary when SPATIAL_PIXEL_AUTH_ENABLED */
  pixel?: PixelEnrollmentResult | null;
}
