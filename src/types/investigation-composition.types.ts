/**
 * Spatial composition of an investigation probe vs a protected asset.
 * Percents of the uploaded image sum to 100. originalUsedPercent is a
 * separate meter (share of the vault original that appears in the probe).
 */
export type CompositionLabelKey = 'protected' | 'ai' | 'other';

/** Internal classification — not the overlay color. */
export type ForensicResultState =
  | 'VERIFIED_VAULT_ORIGIN'
  | 'LIKELY_VAULT_ORIGIN'
  | 'NON_VAULT_MODIFIED'
  | 'AI_SUSPECTED'
  | 'UNKNOWN';

export type PresentationColor = 'GREEN' | 'ORANGE' | 'GREY';

export interface CompositionHowWeKnow {
  narrative: string;
  vaultId?: string;
  vaultFilename?: string;
  dnaRecordId?: string;
  certificateId?: string;
  independentPixelContainsVaultId: false;
}

export interface CompositionCandidateSource {
  vaultId: string;
  filename?: string;
  dnaRecordId?: string;
  localScore: number;
  inliers?: number;
  templateScore?: number;
  coveragePercent?: number;
}

export interface PixelSourceRegionReport {
  id?: string;
  type: string;
  sourceVaultId?: string;
  forensicState?: ForensicResultState;
  presentationColor?: PresentationColor;
  provenanceStatus?: 'DETECTED' | 'NOT DETECTED';
  spatialCorrespondence?: 'VERIFIED' | 'NOT VERIFIED';
  uploadedBounds: { x: number; y: number; width: number; height: number };
  vaultBounds?: { x: number; y: number; width: number; height: number };
  transformation?: {
    labels?: string[];
    scale?: number | null;
    rotationDeg?: number | null;
    translation?: { x: number; y: number } | null;
  };
  scale?: number | null;
  rotationDeg?: number | null;
  matchedFeatures?: number;
  ransacInliers?: number;
  pixelSimilarity?: number | null;
  structuralSimilarity?: number | null;
  dnaVerification?: string;
  confidence: number;
  coveragePercent: number;
  evidenceRadius?: number;
  method?: string;
}

export interface CompositionLabel {
  key: CompositionLabelKey;
  label: string;
  percent: number;
  color: string;
}

export interface ImageCompositionBreakdown {
  /** Area of the uploaded image that matches your protected asset (green). */
  protectedFromAssetPercent: number;
  /** Orange mask share = non-Vault / modified. Not AI-generated. */
  aiGeneratedPercent: number;
  nonVaultPercent?: number;
  /** Independent AI detector share — never copied from non-Vault. */
  aiSuspectedPercent?: number | null;
  /** Unmatched remainder (gray). */
  otherPercent: number;
  /**
   * How much of YOUR original file was reused (bbox / patch coverage on vault).
   * Null when we cannot measure against a vault original.
   */
  originalUsedPercent: number | null;
  quantifiable: boolean;
  estimate: boolean;
  reason: string;
  overlayPngBase64?: string;
  maskPngBase64?: string;
  blockGrid?: { rows: number; cols: number; labels: string };
  labels: CompositionLabel[];
  evidenceModel?: {
    localization: 'pixel_resolution';
    authenticationUnit: 'patch_8x8';
    independentPixelContainsVaultId: false;
    watermarkDoesNotColorPixels: true;
    greyMeansInsufficientEvidence: true;
    evidenceRadiusPx?: number;
    minAuthenticableAreaPx?: number;
    maskEncoding?: 'png_l';
  };
  howWeKnow?: CompositionHowWeKnow;
  candidateSources?: CompositionCandidateSource[];
  probeRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  vaultRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  aiModelAvailable: boolean;
  vaultId?: string;
  vaultFilename?: string;
  dnaRecordId?: string;
  certificateId?: string;
  pixelSource?: {
    originalPixels: number;
    aiSuspectedPixels: number;
    unknownPixels: number;
    totalPixels: number;
    homographyVaultToProbe?: number[] | null;
    regions?: PixelSourceRegionReport[];
    method?: string;
    evidenceRadius?: number;
    transformation?: PixelSourceRegionReport['transformation'];
  };
}
