/**
 * Enterprise document capture pipeline — runs on camera frames only (not upload).
 * Normalizes, de-glares, fuses multi-frame bursts, and exports high-quality JPEG
 * so scanner output matches upload quality for downstream DNA / investigation.
 */
import { analyzeDocumentFrame } from './document-frame-analyzer';

const GUIDE_WIDTH_RATIO = 0.92;
const GUIDE_ASPECT = 3 / 4; // width / height (matches DocumentScanner guide)

function luminanceAt(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
}

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

/** Auto-levels, glare compression, mild sharpen — canvas-only (no backend dependency). */
export function enhanceImageData(imageData: ImageData): ImageData {
  const { width: w, height: h, data } = imageData;
  const n = w * h;
  const lum = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    lum[p] = luminanceAt(data, i);
  }

  const hist = new Uint32Array(256);
  for (let p = 0; p < n; p++) hist[Math.min(255, Math.floor(lum[p]!))]!++;

  let low = 0;
  let high = 255;
  const clip = Math.floor(n * 0.02);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!;
    if (acc >= clip) { low = i; break; }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i]!;
    if (acc >= clip) { high = i; break; }
  }
  const span = Math.max(1, high - low);

  const out = new ImageData(w, h);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    let L = ((lum[p]! - low) / span) * 255;
    // Glare / reflection compression
    if (L > 245) L = 245 - (L - 245) * 0.6;
    const gain = 1.06;
    const r = Math.min(255, Math.max(0, ((data[i]! - low) / span) * 255 * gain));
    const g = Math.min(255, Math.max(0, ((data[i + 1]! - low) / span) * 255 * gain));
    const b = Math.min(255, Math.max(0, ((data[i + 2]! - low) / span) * 255 * gain));
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = b;
    out.data[i + 3] = 255;
  }

  // Mild unsharp mask on luminance
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const i = p * 4;
      const blur =
        (luminanceAt(out.data, i - w * 4)
          + luminanceAt(out.data, i + w * 4)
          + luminanceAt(out.data, i - 4)
          + luminanceAt(out.data, i + 4)) / 4;
      const sharp = luminanceAt(out.data, i);
      const enhanced = Math.min(255, Math.max(0, sharp + (sharp - blur) * 0.35));
      const delta = enhanced - sharp;
      out.data[i] = Math.min(255, Math.max(0, out.data[i]! + delta));
      out.data[i + 1] = Math.min(255, Math.max(0, out.data[i + 1]! + delta));
      out.data[i + 2] = Math.min(255, Math.max(0, out.data[i + 2]! + delta));
    }
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

/**
 * Full forensic capture: burst → fuse → enhance → high-quality JPEG.
 * Used by DocumentScanner single-shot / investigation mode only.
 */
export async function captureForensicScan(
  video: HTMLVideoElement,
  options?: { burstCount?: number; jpegQuality?: number },
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  const burst = await grabFrameBurst(
    video,
    canvas,
    options?.burstCount ?? 5,
    45,
  );
  const fused = fuseFrameBurst(burst) ?? cropToGuideRegion(video, canvas);
  if (!fused) return null;

  const enhanced = enhanceImageData(fused);
  return imageDataToJpegBlob(enhanced, options?.jpegQuality ?? 0.97);
}

/** Quick quality gate — reject blurry / dark captures before investigation. */
export function validateCaptureQuality(imageData: ImageData): { ok: boolean; reason?: string } {
  const { metrics } = analyzeDocumentFrame(imageData, null);
  if (metrics.sharpness < 0.12) {
    return { ok: false, reason: 'Image too blurry — hold device steady and tap Capture when sharp' };
  }
  if (metrics.contrast < 0.09) {
    return { ok: false, reason: 'Lighting too low — move to a brighter area' };
  }
  if (metrics.glare > 0.22) {
    return { ok: false, reason: 'Glare detected — tilt to reduce reflection' };
  }
  if (!metrics.exposureOk) {
    return { ok: false, reason: 'Adjust exposure — document over/under exposed' };
  }
  return { ok: true };
}
