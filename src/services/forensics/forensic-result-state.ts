/**
 * Internal forensic result states. GREEN / ORANGE / GREY are presentation only.
 * non-Vault is never treated as AI-generated.
 */
import type {
  ForensicResultState,
  PixelSourceRegionReport,
  PresentationColor,
} from '../../types/investigation-composition.types';

export const FORENSIC_RESULT_STATES = [
  'VERIFIED_VAULT_ORIGIN',
  'LIKELY_VAULT_ORIGIN',
  'NON_VAULT_MODIFIED',
  'AI_SUSPECTED',
  'UNKNOWN',
] as const satisfies readonly ForensicResultState[];

export const FORENSIC_STATE_PRESENTATION: Record<ForensicResultState, PresentationColor> = {
  VERIFIED_VAULT_ORIGIN: 'GREEN',
  LIKELY_VAULT_ORIGIN: 'GREEN',
  NON_VAULT_MODIFIED: 'ORANGE',
  AI_SUSPECTED: 'ORANGE',
  UNKNOWN: 'GREY',
};

export function presentationColor(state: ForensicResultState): PresentationColor {
  return FORENSIC_STATE_PRESENTATION[state];
}

export interface RegionStateEvidence {
  spatialVerified: boolean;
  ransacInliers: number;
  matchedFeatures: number;
  confidence: number;
  hmacVerified: boolean;
  mappedMismatch: boolean;
  aiDetectorPositive: boolean;
  minInliers?: number;
  minConfidence?: number;
}

/**
 * Classify a region from evidence quality. Colors are applied later.
 */
export function classifyRegionState(e: RegionStateEvidence): ForensicResultState {
  const minInliers = e.minInliers ?? 8;
  const minConfidence = e.minConfidence ?? 0.55;
  const strongSpatial = e.spatialVerified
    && e.ransacInliers >= minInliers
    && e.confidence >= minConfidence;

  if (strongSpatial && e.hmacVerified) return 'VERIFIED_VAULT_ORIGIN';
  if (strongSpatial) return 'LIKELY_VAULT_ORIGIN';
  if (e.mappedMismatch) return 'NON_VAULT_MODIFIED';
  if (e.aiDetectorPositive && !e.spatialVerified) return 'AI_SUSPECTED';
  return 'UNKNOWN';
}

export function provenanceLabel(detected: boolean): 'DETECTED' | 'NOT DETECTED' {
  return detected ? 'DETECTED' : 'NOT DETECTED';
}

export function verifiedLabel(ok: boolean): 'VERIFIED' | 'NOT VERIFIED' {
  return ok ? 'VERIFIED' : 'NOT VERIFIED';
}

export function stampRegionForensicFields(
  region: PixelSourceRegionReport,
  opts: {
    hmacVerified?: boolean;
    provenanceDetected?: boolean;
    aiDetectorPositive?: boolean;
  } = {},
): PixelSourceRegionReport {
  const inliers = region.ransacInliers ?? 0;
  const features = region.matchedFeatures ?? 0;
  const spatialVerified = inliers >= 8 || (region.confidence >= 0.55 && features >= 8);
  const forensicState = classifyRegionState({
    spatialVerified,
    ransacInliers: inliers,
    matchedFeatures: features,
    confidence: region.confidence,
    hmacVerified: Boolean(opts.hmacVerified),
    mappedMismatch: region.type === 'NON_VAULT' || region.type === 'MAPPED_MISMATCH',
    aiDetectorPositive: Boolean(opts.aiDetectorPositive),
  });
  return {
    ...region,
    forensicState,
    presentationColor: presentationColor(forensicState),
    provenanceStatus: provenanceLabel(Boolean(opts.provenanceDetected)),
    spatialCorrespondence: verifiedLabel(spatialVerified),
    dnaVerification: verifiedLabel(Boolean(opts.hmacVerified)),
  };
}

export function applyHmacToRegions(
  regions: PixelSourceRegionReport[] | undefined,
  hmacVerified: boolean,
): PixelSourceRegionReport[] | undefined {
  if (!regions) return regions;
  return regions.map((r) => stampRegionForensicFields(r, {
    hmacVerified,
    provenanceDetected: r.provenanceStatus === 'DETECTED',
  }));
}

export function applyHmacToComposition<T extends {
  pixelSource?: { regions?: PixelSourceRegionReport[] };
}>(composition: T, hmacVerified: boolean): T {
  if (!composition.pixelSource?.regions) return composition;
  return {
    ...composition,
    pixelSource: {
      ...composition.pixelSource,
      regions: applyHmacToRegions(composition.pixelSource.regions, hmacVerified),
    },
  };
}

/** Orange presentation bucket is non-Vault, never an AI synonym. */
export function nonVaultIsNotAiGenerated(): true {
  return true;
}
