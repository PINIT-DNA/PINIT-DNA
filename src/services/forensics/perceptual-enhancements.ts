/**
 * Layer 3 perceptual enhancements — Block Mean Hash, wavelet hash, multi-resolution.
 */
import sharp from 'sharp';
import { dnaEnhancements } from '../../config/dna-enhancements';
import type { PerceptualEnhancementData } from '../../types/dna-enhancements.types';

function bitsToHex(bits: number[]): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const n = (bits[i] ?? 0) * 8 + (bits[i + 1] ?? 0) * 4 + (bits[i + 2] ?? 0) * 2 + (bits[i + 3] ?? 0);
    hex += n.toString(16);
  }
  return hex;
}

function hammingSimilarity(a: string, b: string, bits = 64): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return Math.max(0, 1 - dist / bits);
}

async function toGray(buffer: Buffer, w: number, h: number): Promise<number[]> {
  const raw = await sharp(buffer).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer();
  return Array.from(raw);
}

/** Block Mean Hash — robust to JPEG compression */
export async function computeBmHash64(buffer: Buffer): Promise<string> {
  const grid = 16;
  const pixels = await toGray(buffer, grid, grid);
  const blockSize = 1;
  const blocks: number[] = [];
  for (let y = 0; y < grid; y += blockSize) {
    for (let x = 0; x < grid; x += blockSize) {
      blocks.push(pixels[y * grid + x] ?? 0);
    }
  }
  const mean = blocks.reduce((a, b) => a + b, 0) / blocks.length;
  return bitsToHex(blocks.map((v) => (v > mean ? 1 : 0)));
}

/** Haar wavelet 1-level on 16x16 → 64-bit hash */
export async function computeWaveletHash64(buffer: Buffer): Promise<string> {
  const size = 16;
  let row = await toGray(buffer, size, size);
  const haar1d = (signal: number[]): number[] => {
    const n = signal.length;
    if (n < 2) return signal;
    const out = new Array<number>(n);
    for (let i = 0; i < n / 2; i++) {
      out[i] = (signal[2 * i]! + signal[2 * i + 1]!) / 2;
      out[n / 2 + i] = signal[2 * i]! - signal[2 * i + 1]!;
    }
    return out;
  };
  for (let y = 0; y < size; y++) {
    const r = row.slice(y * size, (y + 1) * size);
    const t = haar1d(r);
    for (let x = 0; x < size; x++) row[y * size + x] = t[x]!;
  }
  const mean = row.reduce((a, b) => a + b, 0) / row.length;
  return bitsToHex(row.slice(0, 64).map((v) => (v > mean ? 1 : 0)));
}

export async function generatePerceptualEnhancements(buffer: Buffer): Promise<PerceptualEnhancementData | undefined> {
  if (!dnaEnhancements.enabled) return undefined;

  const out: PerceptualEnhancementData = {};

  if (dnaEnhancements.layer3.blockMeanHash) {
    out.bmHash64 = await computeBmHash64(buffer);
  }
  if (dnaEnhancements.layer3.waveletHash) {
    out.waveletHash64 = await computeWaveletHash64(buffer);
  }
  if (dnaEnhancements.layer3.multiResolution) {
    out.multiResHashes = {
      s32: await computeBmHash64(await sharp(buffer).resize(32, 32).png().toBuffer()),
      s64: await computeBmHash64(await sharp(buffer).resize(64, 64).png().toBuffer()),
      s128: await computeBmHash64(await sharp(buffer).resize(128, 128).png().toBuffer()),
    };
  }

  return Object.keys(out).length ? out : undefined;
}

export function verifyPerceptualEnhancements(
  probe: PerceptualEnhancementData,
  stored: PerceptualEnhancementData,
): number {
  const scores: number[] = [];

  if (probe.bmHash64 && stored.bmHash64) scores.push(hammingSimilarity(probe.bmHash64, stored.bmHash64));
  if (probe.waveletHash64 && stored.waveletHash64) scores.push(hammingSimilarity(probe.waveletHash64, stored.waveletHash64));

  if (probe.multiResHashes && stored.multiResHashes) {
    for (const key of Object.keys(stored.multiResHashes)) {
      const p = probe.multiResHashes[key];
      const s = stored.multiResHashes[key];
      if (p && s) scores.push(hammingSimilarity(p, s));
    }
  }

  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
