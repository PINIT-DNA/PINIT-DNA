/** Lightweight frame analysis for auto document capture (QR-scanner style). */

export interface FrameMetrics {
  motion: number;
  contrast: number;
  edgeDensity: number;
  sharpness: number;
  glare: number;
  exposureOk: boolean;
  documentPresent: boolean;
  stable: boolean;
  /** Composite 0–1 — high when frame is clear enough for forensic OCR / visual DNA */
  qualityScore: number;
  qualityOk: boolean;
}

function luminance(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
}

/** Downsampled center region of the video frame for fast motion/contrast checks. */
export function sampleVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  sampleW = 160,
  sampleH = 120,
): ImageData | null {
  if (video.videoWidth < 64 || video.videoHeight < 64) return null;

  canvas.width = sampleW;
  canvas.height = sampleH;

  const marginX = video.videoWidth * 0.12;
  const marginY = video.videoHeight * 0.12;
  const sw = video.videoWidth - marginX * 2;
  const sh = video.videoHeight - marginY * 2;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, marginX, marginY, sw, sh, 0, 0, sampleW, sampleH);
  return ctx.getImageData(0, 0, sampleW, sampleH);
}

export function analyzeDocumentFrame(
  current: ImageData,
  previousLum: Float32Array | null,
): { metrics: FrameMetrics; luminance: Float32Array } {
  const w = current.width;
  const h = current.height;
  const n = w * h;
  const lum = new Float32Array(n);

  let sum = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    lum[p] = luminance(current.data, i);
    sum += lum[p]!;
  }
  const mean = sum / n;

  let variance = 0;
  let edges = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const v = lum[p]!;
      variance += (v - mean) ** 2;
      const gx = Math.abs(lum[p + 1]! - lum[p - 1]!);
      const gy = Math.abs(lum[p + w]! - lum[p - w]!);
      if (gx + gy > 22) edges++;
    }
  }

  variance /= n;
  const contrast = Math.min(1, Math.sqrt(variance) / 72);
  const edgeDensity = edges / n;

  let laplacianSum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const lap = Math.abs(
        4 * lum[p]! - lum[p - 1]! - lum[p + 1]! - lum[p - w]! - lum[p + w]!,
      );
      laplacianSum += lap;
    }
  }
  const sharpness = Math.min(1, laplacianSum / n / 36);

  let glarePixels = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (lum[p]! > 238) glarePixels++;
  }
  const glare = glarePixels / n;

  const exposureOk = mean >= 35 && mean <= 228;

  let motion = 1;
  if (previousLum && previousLum.length === n) {
    let diff = 0;
    for (let p = 0; p < n; p++) diff += Math.abs(lum[p]! - previousLum[p]!);
    motion = diff / n / 255;
  }

  const documentPresent =
    contrast > 0.1 &&
    edgeDensity > 0.018 &&
    mean > 28 &&
    mean < 235;

  const stable = motion < 0.04;

  const qualityScore = Math.min(1,
    contrast * 0.28 + sharpness * 0.32 + edgeDensity * 12 + (stable ? 0.18 : 0)
    + (documentPresent ? 0.12 : 0) + (exposureOk ? 0.05 : 0) + (glare < 0.15 ? 0.05 : 0),
  );

  const qualityOk =
    documentPresent &&
    stable &&
    exposureOk &&
    glare < 0.2 &&
    sharpness >= 0.14 &&
    contrast >= 0.11 &&
    edgeDensity >= 0.02;

  return {
    metrics: {
      motion, contrast, edgeDensity, sharpness, glare, exposureOk,
      documentPresent, stable, qualityScore, qualityOk,
    },
    luminance: lum,
  };
}
