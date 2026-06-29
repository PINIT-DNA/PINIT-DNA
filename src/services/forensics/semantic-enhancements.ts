/**
 * Layer 4 semantic enhancements — LAB histogram + color moments.
 */
import sharp from 'sharp';
import { dnaEnhancements } from '../../config/dna-enhancements';
import type { SemanticEnhancementData } from '../../types/dna-enhancements.types';

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rr = r / 255, gg = g / 255, bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
  let x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
  let y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722) / 1.0;
  let z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
  x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
  const L = 116 * y - 16;
  const a = 500 * (x - y);
  const labB = 200 * (y - z);
  return [L, a, labB];
}

function histogram(values: number[], bins: number, min: number, max: number): number[] {
  const hist = new Array(bins).fill(0);
  const range = max - min || 1;
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((v - min) / range) * bins)));
    hist[idx]!++;
  }
  const total = values.length || 1;
  return hist.map((c) => c / total);
}

function moments(values: number[]): { mean: number; std: number; skew: number } {
  const n = values.length || 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const skew = std === 0 ? 0 : values.reduce((a, b) => a + ((b - mean) / std) ** 3, 0) / n;
  return { mean, std, skew };
}

export async function generateSemanticEnhancements(buffer: Buffer): Promise<SemanticEnhancementData | undefined> {
  if (!dnaEnhancements.enabled) return undefined;

  const out: SemanticEnhancementData = {};
  const { data, info } = await sharp(buffer).resize(128, 128, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels ?? 3;
  const L: number[] = [], a: number[] = [], b: number[] = [];

  for (let i = 0; i < data.length; i += channels) {
    const lab = rgbToLab(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    L.push(lab[0]);
    a.push(lab[1]);
    b.push(lab[2]);
  }

  if (dnaEnhancements.layer4.labHistogram) {
    out.labHistogram = {
      L: histogram(L, 32, 0, 100),
      a: histogram(a, 32, -128, 127),
      b: histogram(b, 32, -128, 127),
    };
  }

  if (dnaEnhancements.layer4.colorMoments) {
    const mL = moments(L), ma = moments(a), mb = moments(b);
    out.colorMoments = {
      mean: [mL.mean, ma.mean, mb.mean],
      std: [mL.std, ma.std, mb.std],
      skew: [mL.skew, ma.skew, mb.skew],
    };
  }

  return Object.keys(out).length ? out : undefined;
}

function histSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return Math.max(0, 1 - diff / 2);
}

export function verifySemanticEnhancements(probe: SemanticEnhancementData, stored: SemanticEnhancementData): number {
  const scores: number[] = [];

  if (probe.labHistogram && stored.labHistogram) {
    scores.push(histSimilarity(probe.labHistogram.L, stored.labHistogram.L));
    scores.push(histSimilarity(probe.labHistogram.a, stored.labHistogram.a));
    scores.push(histSimilarity(probe.labHistogram.b, stored.labHistogram.b));
  }

  if (probe.colorMoments && stored.colorMoments) {
    const pm = probe.colorMoments.mean, sm = stored.colorMoments.mean;
    const dist = Math.sqrt(pm.reduce((acc, v, i) => acc + (v - (sm[i] ?? 0)) ** 2, 0));
    scores.push(Math.max(0, 1 - dist / 100));
  }

  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
