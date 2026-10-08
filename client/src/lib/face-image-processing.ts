export type LightingStatus = 'OPTIMAL' | 'TOO_DARK' | 'TOO_BRIGHT';

export interface LightingAnalysis {
  status: LightingStatus;
  average: number;
}

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

export function classifyAmbientBrightness(average: number): LightingStatus {
  if (average < 40) return 'TOO_DARK';
  if (average > 220) return 'TOO_BRIGHT';
  return 'OPTIMAL';
}

export function meanLuminance(data: Uint8ClampedArray): number {
  const pixels = Math.floor(data.length / 4);
  if (pixels <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    sum += LUMA_R * data[o]! + LUMA_G * data[o + 1]! + LUMA_B * data[o + 2]!;
  }
  return sum / pixels;
}

/** Min-max stretch per RGB channel. Leaves alpha unchanged. */
export function minMaxContrastStretch(data: Uint8ClampedArray): void {
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const y = LUMA_R * data[i]! + LUMA_G * data[i + 1]! + LUMA_B * data[i + 2]!;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const range = max - min;
  if (range < 1) return;
  const scale = 255 / range;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, Math.round((data[i]! - min) * scale)));
    data[i + 1] = Math.max(0, Math.min(255, Math.round((data[i + 1]! - min) * scale)));
    data[i + 2] = Math.max(0, Math.min(255, Math.round((data[i + 2]! - min) * scale)));
  }
}

export function analyzeAndCorrectLighting(canvas: HTMLCanvasElement): LightingAnalysis {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 1 || canvas.height < 1) {
    return { status: 'OPTIMAL', average: 128 };
  }
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const average = meanLuminance(data);
  return { status: classifyAmbientBrightness(average), average };
}

export function enhanceFaceImageContrast(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 1 || canvas.height < 1) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  minMaxContrastStretch(image.data);
  ctx.putImageData(image, 0, 0);
}
