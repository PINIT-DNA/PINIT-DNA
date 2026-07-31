/**
 * Phase 3 — Image watermark: DCT mid-frequency coefficients + LSB fallback.
 */
import crypto from 'crypto';

const MARKER = 'P3WM';

/** Embed compact payload into 8x8 DCT blocks of luminance (simplified JPEG-style). */
export function embedImageDctWatermark(
  rgba: Buffer,
  width: number,
  height: number,
  payload: string,
): Buffer {
  const bits = stringToBits(payload);
  const out = Buffer.from(rgba);
  let bitIdx = 0;

  for (let by = 0; by + 8 <= height && bitIdx < bits.length; by += 8) {
    for (let bx = 0; bx + 8 <= width && bitIdx < bits.length; bx += 8) {
      const block = extractLumaBlock(out, width, bx, by);
      const dct = dct8x8(block);
      if (bitIdx < bits.length) {
        dct[3 * 8 + 4] = bits[bitIdx]! ? Math.abs(dct[3 * 8 + 4]!) + 12 : Math.abs(dct[3 * 8 + 4]!) - 12;
        bitIdx++;
      }
      const restored = idct8x8(dct);
      applyLumaBlock(out, width, bx, by, restored);
    }
  }

  if (bitIdx < bits.length) {
    embedLsbTail(out, payload);
  }
  return out;
}

export function extractImageDctWatermark(rgba: Buffer, width: number, height: number): string | null {
  const bits: number[] = [];
  for (let by = 0; by + 8 <= height && bits.length < 4096; by += 8) {
    for (let bx = 0; bx + 8 <= width && bits.length < 4096; bx += 8) {
      const block = extractLumaBlock(rgba, width, bx, by);
      const dct = dct8x8(block);
      bits.push(Math.abs(dct[3 * 8 + 4] ?? 0) > 8 ? 1 : 0);
    }
  }
  const fromDct = bitsToString(bits);
  if (fromDct?.startsWith(MARKER)) return fromDct.slice(MARKER.length);

  return extractLsbTail(rgba);
}

function stringToBits(s: string): number[] {
  const prefixed = MARKER + s;
  const bits: number[] = [];
  for (const ch of prefixed) {
    for (let i = 7; i >= 0; i--) bits.push((ch.codePointAt(0)! >> i) & 1);
  }
  bits.push(0, 0, 0, 0, 0, 0, 0, 0);
  return bits;
}

function bitsToString(bits: number[]): string | null {
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] ?? 0);
    if (b === 0 && bytes.length > 0) break;
    bytes.push(b);
  }
  try {
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return null;
  }
}

function embedLsbTail(buf: Buffer, payload: string): void {
  const tag = Buffer.from(`\n${MARKER}${payload}${MARKER}\n`, 'utf8');
  const start = Math.max(0, buf.length - tag.length - 64);
  tag.copy(buf, start);
}

function extractLsbTail(buf: Buffer): string | null {
  const tail = buf.slice(Math.max(0, buf.length - 512)).toString('utf8');
  const m = tail.match(new RegExp(`${MARKER}(.+?)${MARKER}`));
  return m?.[1] ?? null;
}

function extractLumaBlock(rgba: Buffer, width: number, bx: number, by: number): number[] {
  const block: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = ((by + y) * width + (bx + x)) * 4;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      block.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  return block;
}

function applyLumaBlock(rgba: Buffer, width: number, bx: number, by: number, luma: number[]): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = ((by + y) * width + (bx + x)) * 4;
      const oldL = 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);
      const delta = (luma[y * 8 + x] ?? oldL) - oldL;
      rgba[i] = clamp((rgba[i] ?? 0) + delta);
      rgba[i + 1] = clamp((rgba[i + 1] ?? 0) + delta);
      rgba[i + 2] = clamp((rgba[i + 2] ?? 0) + delta);
    }
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function dct8x8(block: number[]): number[] {
  const out = new Array(64).fill(0);
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          sum += (block[y * 8 + x] ?? 0)
            * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
            * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      out[u * 8 + v] = 0.25 * cu * cv * sum;
    }
  }
  return out;
}

function idct8x8(coeff: number[]): number[] {
  const out = new Array(64).fill(0);
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
          const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
          sum += cu * cv * (coeff[u * 8 + v] ?? 0)
            * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
            * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
      }
      out[y * 8 + x] = 0.25 * sum;
    }
  }
  return out;
}

export function watermarkPayloadHash(payload: string): string {
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
