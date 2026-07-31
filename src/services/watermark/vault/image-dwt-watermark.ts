/**
 * Haar wavelet (1-level) mid-band embedding for vault-store image watermarking.
 */
const MARKER = 'P3DWT';

export function embedImageDwtWatermark(
  rgba: Buffer,
  width: number,
  height: number,
  payload: string,
): Buffer {
  const bits = stringToBits(MARKER + payload);
  const out = Buffer.from(rgba);
  let bitIdx = 0;

  for (let by = 0; by + 16 <= height && bitIdx < bits.length; by += 16) {
    for (let bx = 0; bx + 16 <= width && bitIdx < bits.length; bx += 16) {
      const block = extractLumaBlock16(out, width, bx, by);
      const haar = haar1Level(block);
      if (bitIdx < bits.length) {
        const idx = 8 * 16 + 9;
        haar[idx] = bits[bitIdx]! ? Math.abs(haar[idx]!) + 8 : Math.abs(haar[idx]!) - 8;
        bitIdx++;
      }
      const restored = inverseHaar1Level(haar);
      applyLumaBlock16(out, width, bx, by, restored);
    }
  }

  return out;
}

function stringToBits(s: string): number[] {
  const bits: number[] = [];
  for (const ch of s) {
    for (let i = 7; i >= 0; i--) bits.push((ch.codePointAt(0)! >> i) & 1);
  }
  bits.push(0, 0, 0, 0, 0, 0, 0, 0);
  return bits;
}

function extractLumaBlock16(buf: Buffer, width: number, bx: number, by: number): number[] {
  const block = new Array<number>(256).fill(0);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const px = ((by + y) * width + (bx + x)) * 4;
      block[y * 16 + x] = 0.299 * (buf[px] ?? 0) + 0.587 * (buf[px + 1] ?? 0) + 0.114 * (buf[px + 2] ?? 0);
    }
  }
  return block;
}

function applyLumaBlock16(buf: Buffer, width: number, bx: number, by: number, luma: number[]): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const px = ((by + y) * width + (bx + x)) * 4;
      const orig = 0.299 * (buf[px] ?? 0) + 0.587 * (buf[px + 1] ?? 0) + 0.114 * (buf[px + 2] ?? 0);
      const delta = (luma[y * 16 + x] ?? orig) - orig;
      buf[px] = clamp((buf[px] ?? 0) + delta);
      buf[px + 1] = clamp((buf[px + 1] ?? 0) + delta);
      buf[px + 2] = clamp((buf[px + 2] ?? 0) + delta);
    }
  }
}

function haar1Level(block: number[]): number[] {
  const out = [...block];
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 8; col++) {
      const i = row * 16 + col * 2;
      const a = out[i]!;
      const b = out[i + 1]!;
      out[i] = (a + b) / 2;
      out[i + 1] = (a - b) / 2;
    }
  }
  for (let col = 0; col < 16; col++) {
    for (let row = 0; row < 8; row++) {
      const i = row * 2 * 16 + col;
      const a = out[i]!;
      const b = out[i + 16]!;
      out[i] = (a + b) / 2;
      out[i + 16] = (a - b) / 2;
    }
  }
  return out;
}

function inverseHaar1Level(coeff: number[]): number[] {
  const out = [...coeff];
  for (let col = 0; col < 16; col++) {
    for (let row = 7; row >= 0; row--) {
      const i = row * 2 * 16 + col;
      const avg = out[i]!;
      const diff = out[i + 16]!;
      out[i] = avg + diff;
      out[i + 16] = avg - diff;
    }
  }
  for (let row = 0; row < 16; row++) {
    for (let col = 7; col >= 0; col--) {
      const i = row * 16 + col * 2;
      const avg = out[i]!;
      const diff = out[i + 1]!;
      out[i] = avg + diff;
      out[i + 1] = avg - diff;
    }
  }
  return out;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
