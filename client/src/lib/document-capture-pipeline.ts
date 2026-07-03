/**
 * Enterprise document capture pipeline — runs on camera frames only (not upload).
 * Delegates normalization to scanner-normalization-pipeline.ts, then exports
 * high-quality JPEG for the EXISTING upload investigation API.
 */
import { analyzeDocumentFrame } from './document-frame-analyzer';
import {
  normalizeScannerImage,
  runQualityGate,
  runQualityGateRelaxed,
  classifyScanType,
  ScannerQualityGateError,
  type ScanType,
  type NormalizationProgressCallback,
} from './scanner-normalization-pipeline';

export { ScannerQualityGateError, runQualityGate, type ScanType, type NormalizationProgressCallback };
export { scanTypeLabel, classifyScanType, normalizeScannerBlob } from './scanner-normalization-pipeline';

const GUIDE_WIDTH_RATIO = 0.92;
const GUIDE_ASPECT = 3 / 4; // width / height (matches DocumentScanner guide)

/** Crop to centered document guide region (perspective proxy — user aligns doc in frame). */
export function cropToGuideRegion(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): ImageData | null {
  if (video.videoWidth < 64 || video.videoHeight < 64) return null;

  const guideW = Math.round(video.videoWidth * GUIDE_WIDTH_RATIO);
  const guideH = Math.round(guideW / GUIDE_ASPECT);
  const sx = Math.max(0, Math.round((video.videoWidth - guideW) / 2));
  const sy = Math.max(0, Math.round((video.videoHeight - guideH) / 2));
  const sw = Math.min(guideW, video.videoWidth - sx);
  const sh = Math.min(guideH, video.videoHeight - sy);

  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return ctx.getImageData(0, 0, sw, sh);
}

export function frameSharpness(imageData: ImageData): number {
  const { metrics } = analyzeDocumentFrame(imageData, null);
  return metrics.sharpness;
}

/** Pick sharpest frame, then median-blend top frames for noise reduction. */
export function fuseFrameBurst(frames: ImageData[]): ImageData | null {
  if (!frames.length) return null;
  if (frames.length === 1) return frames[0]!;

  const scored = frames
    .map((f, i) => ({ f, s: frameSharpness(f), i }))
    .sort((a, b) => b.s - a.s);

  const top = scored.slice(0, Math.min(3, scored.length)).map((x) => x.f);
  const w = top[0]!.width;
  const h = top[0]!.height;
  const out = new ImageData(w, h);

  for (let p = 0; p < w * h; p++) {
    const ri: number[] = [];
    const gi: number[] = [];
    const bi: number[] = [];
    for (const fr of top) {
      const i = p * 4;
      ri.push(fr.data[i]!);
      gi.push(fr.data[i + 1]!);
      bi.push(fr.data[i + 2]!);
    }
    ri.sort((a, b) => a - b);
    gi.sort((a, b) => a - b);
    bi.sort((a, b) => a - b);
    const m = Math.floor(ri.length / 2);
    const o = p * 4;
    out.data[o] = ri[m]!;
    out.data[o + 1] = gi[m]!;
    out.data[o + 2] = bi[m]!;
    out.data[o + 3] = 255;
  }
  return out;
}

export function imageDataToJpegBlob(imageData: ImageData, quality = 0.97): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/** Grab N frames from live video (multi-frame fusion burst). */
export async function grabFrameBurst(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  count: number,
  gapMs: number,
): Promise<ImageData[]> {
  const frames: ImageData[] = [];
  for (let i = 0; i < count; i++) {
    const frame = cropToGuideRegion(video, canvas);
    if (frame) frames.push(frame);
    if (i < count - 1) {
      await new Promise((r) => window.setTimeout(r, gapMs));
    }
  }
  return frames;
}

export interface ForensicCaptureResult {
  blob: Blob;
  scanType: ScanType;
  pipelineSteps: string[];
}

export interface InvestigationCaptureOptions {
  burstCount?: number;
  jpegQuality?: number;
  relaxedQualityGate?: boolean;
  onProgress?: (phase: string, label: string) => void;
}

/**
 * Unified Investigation scanner input — burst capture, fuse, normalize, JPEG.
 * Output feeds the SAME backend endpoint as file upload (no duplicate investigation logic).
 */
export async function captureInvestigationInput(
  video: HTMLVideoElement,
  options?: InvestigationCaptureOptions,
): Promise<ForensicCaptureResult | null> {
  const onProgress = options?.onProgress;
  onProgress?.('burst', 'Capturing frames…');

  const canvas = document.createElement('canvas');
  const burstCount = options?.burstCount ?? 3;
  const burst = await grabFrameBurst(video, canvas, burstCount, 35);
  if (!burst.length) return null;

  onProgress?.('fuse', 'Fusing frames…');
  const sharpest = [...burst].sort((a, b) => frameSharpness(b) - frameSharpness(a))[0]!;
  const fused = fuseFrameBurst(burst) ?? sharpest;

  const gateFn = options?.relaxedQualityGate ? runQualityGateRelaxed : runQualityGate;
  const [gate, scanType] = await Promise.all([
    Promise.resolve(gateFn(fused)),
    Promise.resolve(classifyScanType(fused)),
  ]);

  if (!gate.ok) {
    throw new ScannerQualityGateError(gate.guidance ?? 'Capture quality too low');
  }

  onProgress?.('normalize', 'Normalizing capture…');
  const normalized = normalizeScannerImage(fused, scanType, onProgress);
  const blob = await imageDataToJpegBlob(normalized.imageData, options?.jpegQuality ?? 0.97);
  if (!blob) return null;

  return {
    blob,
    scanType: normalized.scanType,
    pipelineSteps: normalized.pipelineSteps,
  };
}

/**
 * Full scanner capture:
 * multi-frame burst → fuse → quality gate → normalization → JPEG.
 * Output is submitted to the same upload investigation endpoint as file uploads.
 */
export async function captureForensicScan(
  video: HTMLVideoElement,
  options?: { burstCount?: number; jpegQuality?: number },
): Promise<ForensicCaptureResult | null> {
  return captureInvestigationInput(video, {
    burstCount: options?.burstCount ?? 5,
    jpegQuality: options?.jpegQuality ?? 0.97,
    relaxedQualityGate: false,
  });
}

/** Quick quality gate — reject blurry / dark captures before investigation. */
export function validateCaptureQuality(imageData: ImageData): { ok: boolean; reason?: string } {
  const gate = runQualityGate(imageData);
  return { ok: gate.ok, reason: gate.guidance };
}
