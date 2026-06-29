/**
 * Layer 2 structural enhancements — multi-scale edge signatures.
 */
import sharp from 'sharp';
import crypto from 'crypto';
import { dnaEnhancements } from '../../config/dna-enhancements';
import type { StructuralEnhancementData } from '../../types/dna-enhancements.types';

async function sobelSignature(buffer: Buffer, size: number): Promise<string> {
  const raw = await sharp(buffer).resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer();
  const w = size, h = size;
  const edges: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx =
        -1 * (raw[idx - w - 1] ?? 0) + 1 * (raw[idx - w + 1] ?? 0)
        + -2 * (raw[idx - 1] ?? 0) + 2 * (raw[idx + 1] ?? 0)
        + -1 * (raw[idx + w - 1] ?? 0) + 1 * (raw[idx + w + 1] ?? 0);
      const gy =
        -1 * (raw[idx - w - 1] ?? 0) + -2 * (raw[idx - w] ?? 0) + -1 * (raw[idx - w + 1] ?? 0)
        + 1 * (raw[idx + w - 1] ?? 0) + 2 * (raw[idx + w] ?? 0) + 1 * (raw[idx + w + 1] ?? 0);
      edges.push(Math.min(255, Math.sqrt(gx * gx + gy * gy)));
    }
  }
  const mean = edges.reduce((a, b) => a + b, 0) / (edges.length || 1);
  const bits = edges.slice(0, 64).map((v) => (v > mean ? 1 : 0));
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i] ?? 0) * 8 + (bits[i + 1] ?? 0) * 4 + (bits[i + 2] ?? 0) * 2 + (bits[i + 3] ?? 0)).toString(16);
  }
  return hex.padEnd(16, '0').slice(0, 16);
}

export async function generateStructuralEnhancements(buffer: Buffer): Promise<StructuralEnhancementData | undefined> {
  if (!dnaEnhancements.enabled || !dnaEnhancements.layer2.multiScaleEdges) return undefined;

  const scales = [32, 64, 128];
  const multiScaleSignatures: Record<string, string> = {};
  for (const s of scales) {
    multiScaleSignatures[`s${s}`] = await sobelSignature(buffer, s);
  }

  return { multiScaleSignatures, algorithmVersion: 'sobel-multiscale-v1' };
}

export function verifyStructuralEnhancements(probe: StructuralEnhancementData, stored: StructuralEnhancementData): number {
  if (!probe.multiScaleSignatures || !stored.multiScaleSignatures) return 0;
  const scores: number[] = [];
  for (const key of Object.keys(stored.multiScaleSignatures)) {
    const p = probe.multiScaleSignatures[key];
    const s = stored.multiScaleSignatures[key];
    if (p && s) scores.push(p === s ? 1 : hammingHex(p, s));
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 0;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return Math.max(0, 1 - dist / (a.length * 4));
}

export function structuralSignatureHash(data: StructuralEnhancementData): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}
