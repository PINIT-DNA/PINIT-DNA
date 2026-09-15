/**
 * Video analog of `investigation-composition.types.ts`'s per-image
 * breakdown, aggregated across a probe video's timeline instead of a
 * single frame. See `src/services/forensics/video-investigation-composition.service.ts`.
 */
import type { ImageCompositionBreakdown } from './investigation-composition.types';

export interface VideoCompositionTimelineSegment {
  tStartMs: number;
  tEndMs: number;
  sourceVaultId: string | null;
  sourceFilename: string | null;
  matchedFrameDnaRecordId: string | null;
  protectedFromAssetPercent: number;
  otherPercent: number;
}

export interface VideoCompositionFramePoint {
  probeIndex: number;
  tMs: number;
  matchedFrameDnaRecordId: string | null;
  breakdown: ImageCompositionBreakdown | null;
  /**
   * Base64 JPEG of the actual probe frame at tMs — sampled frame images are
   * never persisted anywhere retrievable (only their DNA/HKCA fingerprints
   * are), so this is included directly in the report to let the client
   * render a representative frame + overlay per timeline segment.
   */
  probeFrameJpegBase64?: string;
}

export interface VideoCompositionResult {
  vaultId: string;
  vaultDnaRecordId: string;
  vaultFilename: string;
  probeDurationMs: number;
  framesSampled: number;
  framesMatched: number;
  overall: {
    protectedFromAssetPercent: number;
    otherPercent: number;
    originalUsedPercent: number | null;
  };
  timeline: VideoCompositionTimelineSegment[];
  perFrame: VideoCompositionFramePoint[];
}
