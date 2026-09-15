/**
 * DNA vNext evidence model.
 *
 * Pixel-resolution localization is a map over the upload.
 * Authentication is patch/region (8×8 HMAC / hierarchical commit).
 * Robust watermark is provenance/recovery — it must not paint the whole image green.
 * A single RGB pixel is never treated as a complete Vault ID.
 */

export const DNA_A_CRYPTO = 'DNA_A_CRYPTOGRAPHIC' as const;
export const DNA_B_ROBUST = 'DNA_B_ROBUST_PROVENANCE' as const;
export const DNA_C_SPATIAL = 'DNA_C_SPATIAL_FINGERPRINT' as const;

export type DnaMechanism = typeof DNA_A_CRYPTO | typeof DNA_B_ROBUST | typeof DNA_C_SPATIAL;

export interface PixelEvidencePolicy {
  localization: 'pixel_resolution';
  authenticationUnit: 'patch_8x8';
  independentPixelContainsVaultId: false;
  watermarkDoesNotColorPixels: true;
  greyMeansInsufficientEvidence: true;
  evidenceRadiusPx: number;
  minAuthenticableAreaPx: number;
  maskEncoding: 'png_l';
}

export const PIXEL_EVIDENCE_POLICY: PixelEvidencePolicy = {
  localization: 'pixel_resolution',
  authenticationUnit: 'patch_8x8',
  independentPixelContainsVaultId: false,
  watermarkDoesNotColorPixels: true,
  greyMeansInsufficientEvidence: true,
  evidenceRadiusPx: 16,
  minAuthenticableAreaPx: 256,
  maskEncoding: 'png_l',
};

export interface HierarchicalRegionRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cellCount: number;
  /** Truncated HMAC hex — not the server secret. */
  commitHex16: string;
}

export interface DnaVnextProvenanceRecord {
  version: string;
  vaultId: string;
  dnaRecordId: string;
  certificateId: string | null;
  imageHash: string;
  width: number;
  height: number;
  format: string;
  dnaVersion: string;
  watermarkVersion: string;
  authenticationVersion: string;
  blockSize: number;
  watermarkLookupId: string;
  rootAuthenticationHex16: string;
  regionManifest: HierarchicalRegionRecord[];
  createdAt: string;
}

export interface RobustWatermarkRecovery {
  recovered: boolean;
  mechanism: typeof DNA_B_ROBUST;
  watermarkVersion: string;
  vaultId?: string;
  dnaRecordId?: string;
  certificateId?: string | null;
  spatialConfidencePercent: number;
  supportRegion?: { x: number; y: number; width: number; height: number };
  /** Provenance only — never used as pixel coverage. */
  doesNotImplyPixelCoverage: true;
}

export interface DnaVnextInvestigationSection {
  policy: PixelEvidencePolicy;
  mechanisms: {
    dnaA: { present: boolean; role: string };
    dnaB: { present: boolean; role: string; recovery?: RobustWatermarkRecovery | null };
    dnaC: { present: boolean; role: string };
  };
  provenance?: DnaVnextProvenanceRecord | null;
  transformations: string[];
  note: string;
}
