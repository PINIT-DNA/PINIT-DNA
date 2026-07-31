/**
 * Enterprise document capture pipeline — runs on camera frames only (not upload).
 * Delegates normalization to scanner-normalization-pipeline.ts, then exports
 * high-quality JPEG for the EXISTING upload investigation API.
 */
import { analyzeDocumentFrame } from './document-frame-analyzer';
import {
  normalizeScannerImage,
  normalizeScannerImageForInvestigation,
  runQualityGate,
  runQualityGateRelaxed,
  classifyScanType,
  ScannerQualityGateError,
  type ScanType,
  type NormalizationProgressCallback,
} from './scanner-normalization-pipeline';
import {
  canvasToBlobWithTimeout,
  delay,
  runTimedStage,
  runTimedStageSync,
  ScannerStageTimeoutError,
} from './scanner-async-utils';

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

/**
 * Full-frame capture — same pixels a phone camera would save on upload.
 * Do NOT crop to the UI guide; that destroys vault visual DNA.
 */
export function grabFullFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): ImageData | null {
  if (video.videoWidth < 64 || video.videoHeight < 64) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
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
  return canvasToBlobWithTimeout(canvas, 'image/jpeg', quality);
}

/** Grab N full frames from live video (multi-frame fusion burst). */
export async function grabFrameBurst(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  count: number,
  gapMs: number,
  options?: { fullFrame?: boolean },
): Promise<ImageData[]> {
  const frames: ImageData[] = [];
  const grab = options?.fullFrame === false ? cropToGuideRegion : grabFullFrame;
  for (let i = 0; i < count; i++) {
    const frame = grab(video, canvas);
    if (frame) frames.push(frame);
    if (i < count - 1) {
      await delay(gapMs);
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
 * Unified Investigation scanner input — full-frame burst, light upload-like normalize, JPEG.
 * Output is a File submitted to the SAME unifiedInvestigateStream endpoint as Upload.
 * No separate investigation path — only the image source differs (camera vs file picker).
 */
export async function captureInvestigationInput(
  video: HTMLVideoElement,
  options?: InvestigationCaptureOptions,
): Promise<ForensicCaptureResult | null> {
  const onProgress = options?.onProgress;
  const burstCount = options?.burstCount ?? 3;
  const jpegQuality = options?.jpegQuality ?? 0.95;
  const CAPTURE_BUDGET_MS = 25_000;

  return runTimedStage('captureInvestigationInput', async () => {
    onProgress?.('burst', 'Capturing frames…');

    const canvas = document.createElement('canvas');
    const burst = await runTimedStage(
      'grabFrameBurst',
      () => grabFrameBurst(video, canvas, burstCount, 35, { fullFrame: true }),
      8_000,
    );
    if (!burst.length) return null;

    onProgress?.('fuse', 'Selecting sharpest frame…');
    // Prefer single sharpest full frame — fusion can blur ORB/pHash features.
    const fused = runTimedStageSync('pickSharpestFrame', () =>
      [...burst].sort((a, b) => frameSharpness(b) - frameSharpness(a))[0]!);

    const gateFn = options?.relaxedQualityGate ? runQualityGateRelaxed : runQualityGate;
    const gate = gateFn(fused);

    if (!gate.ok) {
      throw new ScannerQualityGateError(gate.guidance ?? 'Capture quality too low');
    }

    onProgress?.('normalize', 'Preparing investigation input…');
    const normalized = runTimedStageSync('normalizeInvestigation', () =>
      normalizeScannerImageForInvestigation(fused, (step, label) => onProgress?.(step, label)));

    const blob = await runTimedStage(
      'imageDataToJpegBlob',
      () => imageDataToJpegBlob(normalized.imageData, jpegQuality),
      10_000,
    );
    if (!blob) return null;

    return {
      blob,
      scanType: normalized.scanType,
      pipelineSteps: normalized.pipelineSteps,
    };
  }, CAPTURE_BUDGET_MS);
}

export { ScannerStageTimeoutError };

/**
 * Full scanner capture:
 * multi-frame burst → fuse → quality gate → normalization → JPEG.
 * Output is submitted to the same upload investigation endpoint as file uploads.
 */
export async function captureForensicScan(
  video: HTMLVideoElement,
  options?: { burstCount?: number; jpegQuality?: number },
): Promise<ForensicCaptureResult | null> {
  const onProgress = options as { onProgress?: InvestigationCaptureOptions['onProgress'] } | undefined;
  const burstCount = options?.burstCount ?? 5;
  const canvas = document.createElement('canvas');
  const burst = await grabFrameBurst(video, canvas, burstCount, 35);
  if (!burst.length) return null;

  const sharpest = [...burst].sort((a, b) => frameSharpness(b) - frameSharpness(a))[0]!;
  const fused = fuseFrameBurst(burst) ?? sharpest;
  const gate = runQualityGate(fused);
  if (!gate.ok) throw new ScannerQualityGateError(gate.guidance ?? 'Capture quality too low');

  const scanType = classifyScanType(fused);
  const normalized = runTimedStageSync('normalizeFull', () =>
    normalizeScannerImage(fused, scanType, onProgress?.onProgress));
  const blob = await imageDataToJpegBlob(normalized.imageData, options?.jpegQuality ?? 0.97);
  if (!blob) return null;

  return {
    blob,
    scanType: normalized.scanType,
    pipelineSteps: normalized.pipelineSteps,
  };
}

/** Quick quality gate — reject blurry / dark captures before investigation. */
export function validateCaptureQuality(imageData: ImageData): { ok: boolean; reason?: string } {
  const gate = runQualityGate(imageData);
  return { ok: gate.ok, reason: gate.guidance };
}
