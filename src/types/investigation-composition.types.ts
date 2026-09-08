/**
 * Spatial composition of an investigation probe vs a protected asset.
 * Percents of the uploaded image sum to 100. originalUsedPercent is a
 * separate meter (share of the vault original that appears in the probe).
 */
export type CompositionLabelKey = 'protected' | 'ai' | 'other';

export interface CompositionLabel {
  key: CompositionLabelKey;
  label: string;
  percent: number;
  color: string;
}

export interface ImageCompositionBreakdown {
  /** Area of the uploaded image that matches your protected asset (green). */
  protectedFromAssetPercent: number;
  /** Unmatched area classified as AI-generated (amber). */
  aiGeneratedPercent: number;
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
  probeRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  vaultRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  aiModelAvailable: boolean;
  vaultId?: string;
  vaultFilename?: string;
  pixelSource?: {
    originalPixels: number;
    aiSuspectedPixels: number;
    unknownPixels: number;
    totalPixels: number;
    homographyVaultToProbe?: number[] | null;
    regions?: Array<{
      type: string;
      uploadedBounds: { x: number; y: number; width: number; height: number };
      vaultBounds?: { x: number; y: number; width: number; height: number };
      confidence: number;
      coveragePercent: number;
    }>;
    method?: string;
  };
}
