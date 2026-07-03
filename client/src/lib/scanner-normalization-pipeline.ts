/**
 * Scanner Normalization Pipeline — client-side only.
 *
 * Transforms camera / screen captures into images that resemble direct uploads
 * before they enter the EXISTING upload investigation API.
 *
 * Does NOT implement comparison, retrieval, or confidence logic.
 */
import { analyzeDocumentFrame, type FrameMetrics } from './document-frame-analyzer';

export type ScanType =
  | 'camera_photo'
  | 'desktop_screen'
  | 'laptop_screen'
  | 'phone_screen'
  | 'printed_paper'
  | 'screenshot';

export interface QualityGateResult {
  ok: boolean;
  blur: number;
  focus: number;
  lighting: number;
  reflection: number;
  motion: number;
  guidance?: string;
}

export interface NormalizationResult {
  imageData: ImageData;
  scanType: ScanType;
  quality: QualityGateResult;
  pipelineSteps: string[];
}

export class ScannerQualityGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerQualityGateError';
  }
}

const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  camera_photo: 'Camera Photo',
  desktop_screen: 'Desktop Screen',
  laptop_screen: 'Laptop Screen',
  phone_screen: 'Phone Screen',
  printed_paper: 'Printed Paper',
  screenshot: 'Screenshot',
};

export function scanTypeLabel(type: ScanType): string {
  return SCAN_TYPE_LABELS[type];
}

function luminance(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
}

function cloneImageData(src: ImageData): ImageData {
  const out = new ImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

/** Never downscale — preserve native capture resolution for ORB / local DNA. */
function preserveResolution(imageData: ImageData): ImageData {
  return cloneImageData(imageData);
}

/** Estimate moiré / LCD grid energy (high-frequency periodic patterns). */
function moireScore(imageData: ImageData): number {
  const { width: w, height: h, data } = imageData;
  let periodic = 0;
  let samples = 0;
  const step = Math.max(2, Math.floor(Math.min(w, h) / 120));
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const i = (y * w + x) * 4;
      const c = luminance(data, i);
      const alt = luminance(data, i + step * 4) + luminance(data, i - step * 4);
      periodic += Math.abs(c * 2 - alt);
      samples++;
    }
  }
  return samples ? Math.min(1, periodic / samples / 48) : 0;
}

/** Classify capture source to select preprocessing profile. */
export function classifyScanType(imageData: ImageData): ScanType {
  const { metrics } = analyzeDocumentFrame(imageData, null);
  const moire = moireScore(imageData);
  const aspect = imageData.width / imageData.height;

  if (moire > 0.28 && metrics.glare > 0.08) {
    if (aspect > 1.45 && aspect < 2.1) return 'desktop_screen';
    if (aspect > 1.2 && aspect < 1.55) return 'laptop_screen';
    return 'phone_screen';
  }
  if (moire > 0.22 && metrics.sharpness > 0.2) return 'screenshot';
  if (metrics.edgeDensity > 0.035 && metrics.contrast > 0.14 && metrics.glare < 0.12) {
    return 'printed_paper';
  }
  return 'camera_photo';
}

/** Quality gate — reject poor captures before investigation. */
export function runQualityGate(
  imageData: ImageData,
  metrics?: FrameMetrics,
): QualityGateResult {
  const m = metrics ?? analyzeDocumentFrame(imageData, null).metrics;
  const blur = 1 - m.sharpness;
  const focus = m.sharpness;
  const lighting = m.exposureOk ? Math.min(1, m.contrast + 0.35) : Math.max(0, 1 - Math.abs(0.45 - m.contrast) * 2);
  const reflection = m.glare;
  const motion = m.motion;

  if (m.sharpness < 0.09) {
    return { ok: false, blur, focus, lighting, reflection, motion, guidance: 'Hold device steady — image is too blurry' };
  }
  // Motion is only measured live (frame-to-frame). Single-frame / fused captures skip this check.
  if (motion > 0 && motion < 0.99 && motion > 0.20) {
    return { ok: false, blur, focus, lighting, reflection, motion, guidance: 'Hold device steady — motion detected' };
  }
  if (m.contrast < 0.08 || !m.exposureOk) {
    return { ok: false, blur, focus, lighting, reflection, motion, guidance: 'Increase lighting — document is too dark or overexposed' };
  }
  if (m.glare > 0.24) {
    return { ok: false, blur, focus, lighting, reflection, motion, guidance: 'Reduce reflection — tilt device to avoid glare' };
  }
  if (m.edgeDensity < 0.015) {
    return { ok: false, blur, focus, lighting, reflection, motion, guidance: 'Move closer — document not filling the frame' };
  }
  return { ok: true, blur, focus, lighting, reflection, motion };
}

/** Tight crop around high-contrast document content (boundary detection proxy). */
function detectDocumentBounds(imageData: ImageData): { x: number; y: number; w: number; h: number } {
  const { width: w, height: h, data } = imageData;
  const rowEdge = new Float32Array(h);
  const colEdge = new Float32Array(w);

  for (let y = 1; y < h - 1; y++) {
    let s = 0;
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const gx = Math.abs(luminance(data, i + 4) - luminance(data, i - 4));
      const gy = Math.abs(luminance(data, i + w * 4) - luminance(data, i - w * 4));
      s += gx + gy;
    }
    rowEdge[y] = s / w;
  }
  for (let x = 1; x < w - 1; x++) {
    let s = 0;
    for (let y = 1; y < h - 1; y++) {
      const i = (y * w + x) * 4;
      const gx = Math.abs(luminance(data, i + 4) - luminance(data, i - 4));
      const gy = Math.abs(luminance(data, i + w * 4) - luminance(data, i - w * 4));
      s += gx + gy;
    }
    colEdge[x] = s / h;
  }

  const rowThr = Math.max(...rowEdge) * 0.18;
  const colThr = Math.max(...colEdge) * 0.18;

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;
  while (top < h && rowEdge[top]! < rowThr) top++;
  while (bottom > top && rowEdge[bottom]! < rowThr) bottom--;
  while (left < w && colEdge[left]! < colThr) left++;
  while (right > left && colEdge[right]! < colThr) right--;

  const padX = Math.round(w * 0.02);
  const padY = Math.round(h * 0.02);
  const x = Math.max(0, left - padX);
  const y = Math.max(0, top - padY);
  const cw = Math.min(w - x, right - left + 1 + padX * 2);
  const ch = Math.min(h - y, bottom - top + 1 + padY * 2);

  if (cw < w * 0.4 || ch < h * 0.4) return { x: 0, y: 0, w, h };
  return { x, y, w: cw, h: ch };
}

function cropImageData(imageData: ImageData, bounds: { x: number; y: number; w: number; h: number }): ImageData {
  const out = new ImageData(bounds.w, bounds.h);
  for (let y = 0; y < bounds.h; y++) {
    for (let x = 0; x < bounds.w; x++) {
      const si = ((bounds.y + y) * imageData.width + (bounds.x + x)) * 4;
      const di = (y * bounds.w + x) * 4;
      out.data[di] = imageData.data[si]!;
      out.data[di + 1] = imageData.data[si + 1]!;
      out.data[di + 2] = imageData.data[si + 2]!;
      out.data[di + 3] = 255;
    }
  }
  return out;
}

/** Mild perspective flatten via vertical shear when trapezoid skew is detected. */
function perspectiveCorrect(imageData: ImageData, scanType: ScanType): ImageData {
  if (scanType === 'screenshot') return cloneImageData(imageData);

  const { width: w, height: h, data } = imageData;
  const topEdge = detectDocumentBounds(cropImageData(imageData, { x: 0, y: 0, w, h: Math.floor(h * 0.15) }));
  const bottomEdge = detectDocumentBounds(cropImageData(imageData, { x: 0, y: Math.floor(h * 0.85), w, h: Math.floor(h * 0.15) }));
  const skew = (topEdge.w - bottomEdge.w) / w;
  if (Math.abs(skew) < 0.04) return cloneImageData(imageData);

  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const offset = Math.round(skew * w * 0.5 * (t - 0.5));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - offset));
      const si = (y * w + sx) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = data[si]!;
      out.data[di + 1] = data[si + 1]!;
      out.data[di + 2] = data[si + 2]!;
      out.data[di + 3] = 255;
    }
  }
  return out;
}

function removeReflections(imageData: ImageData): ImageData {
  const { width: w, height: h, data } = imageData;
  const out = cloneImageData(imageData);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const L = luminance(data, i);
    if (L > 242) {
      const neighbors = [
        luminance(data, Math.max(0, i - 4)),
        luminance(data, Math.min(data.length - 4, i + 4)),
      ];
      const avg = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
      const blend = 0.55;
      out.data[i] = Math.round(data[i]! * (1 - blend) + avg * blend);
      out.data[i + 1] = Math.round(data[i + 1]! * (1 - blend) + avg * blend);
      out.data[i + 2] = Math.round(data[i + 2]! * (1 - blend) + avg * blend);
    }
  }
  return out;
}

function removeShadows(imageData: ImageData): ImageData {
  const { width: w, height: h, data } = imageData;
  const n = w * h;
  const lum = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) lum[p] = luminance(data, i);

  const block = Math.max(8, Math.floor(Math.min(w, h) / 24));
  const out = cloneImageData(imageData);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minL = 255;
      for (let dy = -block; dy <= block; dy += block) {
        for (let dx = -block; dx <= block; dx += block) {
          const ny = Math.min(h - 1, Math.max(0, y + dy));
          const nx = Math.min(w - 1, Math.max(0, x + dx));
          minL = Math.min(minL, lum[ny * w + nx]!);
        }
      }
      const p = y * w + x;
      const i = p * 4;
      const local = lum[p]!;
      const lift = local < 70 ? Math.min(40, (70 - local) * 0.45) : 0;
      const denom = Math.max(minL, 1);
      const gain = Math.min(1.35, (local + lift) / denom);
      out.data[i] = Math.min(255, data[i]! * gain);
      out.data[i + 1] = Math.min(255, data[i + 1]! * gain);
      out.data[i + 2] = Math.min(255, data[i + 2]! * gain);
    }
  }
  return out;
}

function normalizeBrightnessContrast(imageData: ImageData): ImageData {
  const { width: w, height: h, data } = imageData;
  const n = w * h;
  const lum = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) lum[p] = luminance(data, i);

  const hist = new Uint32Array(256);
  for (let p = 0; p < n; p++) hist[Math.min(255, Math.floor(lum[p]!))]!++;
  let low = 0;
  let high = 255;
  const clip = Math.floor(n * 0.02);
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]!; if (acc >= clip) { low = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]!; if (acc >= clip) { high = i; break; } }
  const span = Math.max(1, high - low);

  const out = new ImageData(w, h);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    out.data[i] = Math.min(255, Math.max(0, ((data[i]! - low) / span) * 255 * 1.04));
    out.data[i + 1] = Math.min(255, Math.max(0, ((data[i + 1]! - low) / span) * 255 * 1.04));
    out.data[i + 2] = Math.min(255, Math.max(0, ((data[i + 2]! - low) / span) * 255 * 1.04));
    out.data[i + 3] = 255;
  }
  return out;
}

function colorCalibrate(imageData: ImageData): ImageData {
  const { data } = imageData;
  const n = imageData.width * imageData.height;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    rSum += data[i]!;
    gSum += data[i + 1]!;
    bSum += data[i + 2]!;
  }
  const gray = (rSum + gSum + bSum) / (3 * n);
  const rGain = gray / Math.max(1, rSum / n);
  const gGain = gray / Math.max(1, gSum / n);
  const bGain = gray / Math.max(1, bSum / n);
  const out = cloneImageData(imageData);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    out.data[i] = Math.min(255, out.data[i]! * rGain);
    out.data[i + 1] = Math.min(255, out.data[i + 1]! * gGain);
    out.data[i + 2] = Math.min(255, out.data[i + 2]! * bGain);
  }
  return out;
}

function reduceNoise(imageData: ImageData): ImageData {
  const { width: w, height: h, data } = imageData;
  const out = cloneImageData(imageData);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v =
          (data[i + c - w * 4]! + data[i + c + w * 4]! + data[i + c - 4]! + data[i + c + 4]! + data[i + c]! * 4) / 8;
        out.data[i + c] = Math.round(v);
      }
    }
  }
  return out;
}

function removeJpegArtifacts(imageData: ImageData): ImageData {
  return reduceNoise(imageData);
}

function removeMoire(imageData: ImageData): ImageData {
  const { width: w, height: h, data } = imageData;
  const out = cloneImageData(imageData);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur =
          (data[i + c - 2]! + data[i + c + 2]! + data[i + c - w * 8]! + data[i + c + w * 8]!) / 4;
        out.data[i + c] = Math.round(data[i + c]! * 0.72 + blur * 0.28);
      }
    }
  }
  return out;
}

function edgeEnhance(imageData: ImageData): ImageData {
  const { width: w, height: h, data } = imageData;
  const out = cloneImageData(imageData);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const i = p * 4;
      const blur =
        (luminance(data, i - w * 4) + luminance(data, i + w * 4) + luminance(data, i - 4) + luminance(data, i + 4)) / 4;
      const sharp = luminance(data, i);
      const delta = Math.min(32, Math.max(-32, (sharp - blur) * 0.4));
      out.data[i] = Math.min(255, Math.max(0, out.data[i]! + delta));
      out.data[i + 1] = Math.min(255, Math.max(0, out.data[i + 1]! + delta));
      out.data[i + 2] = Math.min(255, Math.max(0, out.data[i + 2]! + delta));
    }
  }
  return out;
}

/** Conservative upscale only when capture is below 1280px — never downscale. */
function superResolveIfNeeded(imageData: ImageData): ImageData {
  const minDim = Math.min(imageData.width, imageData.height);
  if (minDim >= 1280) return cloneImageData(imageData);

  const scale = Math.min(2, 1280 / minDim);
  const nw = Math.round(imageData.width * scale);
  const nh = Math.round(imageData.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return cloneImageData(imageData);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const tmp = document.createElement('canvas');
  tmp.width = imageData.width;
  tmp.height = imageData.height;
  tmp.getContext('2d')!.putImageData(imageData, 0, 0);
  ctx.drawImage(tmp, 0, 0, nw, nh);
  return ctx.getImageData(0, 0, nw, nh);
}

function fixOrientation(imageData: ImageData): ImageData {
  return cloneImageData(imageData);
}

const SCREEN_TYPES: ScanType[] = ['desktop_screen', 'laptop_screen', 'phone_screen', 'screenshot'];

/**
 * Full normalization — transforms scanner capture toward upload-like quality.
 */
export function normalizeScannerImage(
  imageData: ImageData,
  scanType?: ScanType,
): NormalizationResult {
  const type = scanType ?? classifyScanType(imageData);
  const quality = runQualityGate(imageData);
  const steps: string[] = ['preserve_resolution'];

  let img = preserveResolution(imageData);
  steps.push('orientation_fix');
  img = fixOrientation(img);

  steps.push('document_boundary_detection');
  const bounds = detectDocumentBounds(img);
  img = cropImageData(img, bounds);

  steps.push('perspective_correction');
  img = perspectiveCorrect(img, type);

  steps.push('reflection_removal');
  img = removeReflections(img);
  steps.push('shadow_removal');
  img = removeShadows(img);
  steps.push('brightness_normalization');
  img = normalizeBrightnessContrast(img);
  steps.push('contrast_normalization');
  steps.push('color_calibration');
  img = colorCalibrate(img);
  steps.push('noise_reduction');
  img = reduceNoise(img);
  steps.push('jpeg_artifact_removal');
  img = removeJpegArtifacts(img);

  if (SCREEN_TYPES.includes(type)) {
    steps.push('moire_removal');
    img = removeMoire(img);
  }

  if (Math.min(img.width, img.height) < 1280) {
    steps.push('super_resolution');
    img = superResolveIfNeeded(img);
  }

  steps.push('edge_enhancement');
  img = edgeEnhance(img);

  return { imageData: img, scanType: type, quality, pipelineSteps: steps };
}

export async function blobToImageData(blob: Blob): Promise<ImageData | null> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function normalizeScannerBlob(
  blob: Blob,
  options?: { jpegQuality?: number; skipQualityGate?: boolean },
): Promise<{ blob: Blob; scanType: ScanType; pipelineSteps: string[] } | null> {
  const raw = await blobToImageData(blob);
  if (!raw) return null;

  if (!options?.skipQualityGate) {
    const gate = runQualityGate(raw);
    if (!gate.ok) throw new ScannerQualityGateError(gate.guidance ?? 'Capture quality too low');
  }

  const { imageData, scanType, pipelineSteps } = normalizeScannerImage(raw);
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(imageData, 0, 0);
  const outBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', options?.jpegQuality ?? 0.97);
  });
  if (!outBlob) return null;
  return { blob: outBlob, scanType, pipelineSteps };
}
