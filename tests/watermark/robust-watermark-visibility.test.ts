/**
 * DNA-B Patchwork must stay machine-detectable without painting a visible
 * 8px/16px checkerboard onto smooth regions (Dress.jpeg / protected export).
 *
 * Pixel equality is not required — an embedded signal necessarily changes
 * some pixels. What this file forbids is a periodic tile-half luminance
 * grid strong enough for a normal viewer to see.
 */
import { describe, test, expect } from '@jest/globals';
import sharp from 'sharp';
import {
  embedRobustProvenanceWatermark,
  extractWatermarkLookupId,
} from '../../src/services/dna-vnext/robust-watermark';
import { watermarkLookupId } from '../../src/services/dna-vnext/crypto';

const VAULT_ID = 'vault-visibility-dress';
const DNA_RECORD_ID = 'dna-visibility-dress';
const TIMEOUT = 60_000;

/** Smooth red-dress / wall / floor analogue — the artifact shows here, not on busy texture. */
async function makeDressLike(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const wall = y < height * 0.62;
      const inDress =
        x > width * 0.28 &&
        x < width * 0.72 &&
        y > height * 0.18 &&
        y < height * 0.92;
      if (inDress) {
        raw[i] = 168;
        raw[i + 1] = 28;
        raw[i + 2] = 42;
      } else if (wall) {
        raw[i] = 214;
        raw[i + 1] = 196;
        raw[i + 2] = 176;
      } else {
        raw[i] = 92;
        raw[i + 1] = 78;
        raw[i + 2] = 68;
      }
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function toLuma(buffer: Buffer, width: number, height: number): Promise<Float64Array> {
  const { data } = await sharp(buffer)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const luma = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    luma[i] = 0.299 * data[i * 3]! + 0.587 * data[i * 3 + 1]! + 0.114 * data[i * 3 + 2]!;
  }
  return luma;
}

function mae(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return s / a.length;
}

function psnr(a: Float64Array, b: Float64Array): number {
  let mse = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    mse += d * d;
  }
  mse /= a.length;
  if (mse < 1e-12) return 99;
  return 10 * Math.log10((255 * 255) / mse);
}

/** Mean SSIM over 8×8 windows (luma only). */
function ssim8(a: Float64Array, b: Float64Array, width: number, height: number): number {
  const k1 = 0.01;
  const k2 = 0.03;
  const L = 255;
  const c1 = (k1 * L) ** 2;
  const c2 = (k2 * L) ** 2;
  const win = 8;
  let acc = 0;
  let n = 0;
  for (let y = 0; y + win <= height; y += win) {
    for (let x = 0; x + win <= width; x += win) {
      let sumA = 0;
      let sumB = 0;
      let sumA2 = 0;
      let sumB2 = 0;
      let sumAB = 0;
      for (let yy = 0; yy < win; yy++) {
        for (let xx = 0; xx < win; xx++) {
          const ia = a[(y + yy) * width + (x + xx)]!;
          const ib = b[(y + yy) * width + (x + xx)]!;
          sumA += ia;
          sumB += ib;
          sumA2 += ia * ia;
          sumB2 += ib * ib;
          sumAB += ia * ib;
        }
      }
      const np = win * win;
      const muA = sumA / np;
      const muB = sumB / np;
      const varA = sumA2 / np - muA * muA;
      const varB = sumB2 / np - muB * muB;
      const cov = sumAB / np - muA * muB;
      const num = (2 * muA * muB + c1) * (2 * cov + c2);
      const den = (muA * muA + muB * muB + c1) * (varA + varB + c2);
      acc += den === 0 ? 1 : num / den;
      n++;
    }
  }
  return n ? acc / n : 0;
}

/**
 * Strength of an 8-pixel-column checkerboard in the residual (protected − original).
 * The old WM_DELTA=12 embed produced ~24 here on smooth fields.
 */
function eightPxColumnGridScore(diff: Float64Array, width: number, height: number): number {
  const bands = Math.floor(width / 8);
  if (bands < 4) return 0;
  const colMean = new Array<number>(bands).fill(0);
  const colN = new Array<number>(bands).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < bands * 8; x++) {
      const b = Math.floor(x / 8);
      colMean[b]! += diff[y * width + x]!;
      colN[b]! += 1;
    }
  }
  for (let i = 0; i < bands; i++) colMean[i]! /= Math.max(1, colN[i]!);
  let step = 0;
  for (let i = 0; i < bands - 1; i++) step += Math.abs(colMean[i]! - colMean[i + 1]!);
  return step / (bands - 1);
}

function residual(a: Float64Array, b: Float64Array): Float64Array {
  const d = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) d[i] = b[i]! - a[i]!;
  return d;
}

describe('DNA-B Patchwork is not a visible checkerboard', () => {
  test('smooth dress-like JPEG export: high PSNR/SSIM, weak 8px grid, lookup still recovers', async () => {
    const W = 1280;
    const H = 960;
    const original = await makeDressLike(W, H);
    const result = await embedRobustProvenanceWatermark({
      buffer: original,
      mimeType: 'image/jpeg',
      vaultId: VAULT_ID,
      dnaRecordId: DNA_RECORD_ID,
    });
    expect(result.embedded).toBe(true);
    expect(await extractWatermarkLookupId(result.buffer)).toBe(watermarkLookupId(VAULT_ID, DNA_RECORD_ID));

    const origL = await toLuma(original, W, H);
    const protL = await toLuma(result.buffer, W, H);
    const maeL = mae(origL, protL);
    const psnrL = psnr(origL, protL);
    const ssimL = ssim8(origL, protL, W, H);
    const grid = eightPxColumnGridScore(residual(origL, protL), W, H);

    // Uniform ±12 luma on every pixel is ~MAE 12, PSNR ~26.6 dB, grid ~24.
    // eslint-disable-next-line no-console
    console.log('dress-like JPEG quality', { maeL, psnrL, ssimL, grid });
    expect(maeL).toBeLessThan(4);
    expect(psnrL).toBeGreaterThan(38);
    expect(ssimL).toBeGreaterThan(0.95);
    expect(grid).toBeLessThan(8);
  }, TIMEOUT);

  test('lossless PNG embed on the same smooth field still recovers DNA-B', async () => {
    const W = 960;
    const H = 800;
    const original = await makeDressLike(W, H);
    const result = await embedRobustProvenanceWatermark({
      buffer: original,
      mimeType: 'image/png',
      vaultId: VAULT_ID,
      dnaRecordId: DNA_RECORD_ID,
    });
    expect(result.embedded).toBe(true);
    expect(await extractWatermarkLookupId(result.buffer)).toBe(watermarkLookupId(VAULT_ID, DNA_RECORD_ID));
    const origL = await toLuma(original, W, H);
    const protL = await toLuma(result.buffer, W, H);
    expect(eightPxColumnGridScore(residual(origL, protL), W, H)).toBeLessThan(8);
    expect(psnr(origL, protL)).toBeGreaterThan(40);
  }, TIMEOUT);
});
