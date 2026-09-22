/**
 * Patch fingerprints computed directly from raw frame pixels.
 *
 * The encoded-image path runs seven sharp pipelines per patch (pHash, dHash, aHash,
 * edge, colour, frequency, texture). At ~1,865 patches per frame that is ~13,000
 * image pipelines for ONE frame — measured at 22-35 s per frame, which is what made
 * protecting every frame of a video take days.
 *
 * Every descriptor here is the same arithmetic as the sharp path, in one pass over
 * the pixels the decoder already produced:
 *   - greyscale uses the Rec.709 luma weights sharp uses;
 *   - downsampling is a box average, which is what area-resampling a small tile does,
 *     and it commutes with the luma combination, so "greyscale then resize" gives the
 *     same values as "resize then greyscale" up to rounding;
 *   - the bit-packing, thresholds and hex widths are copied exactly from the sharp
 *     path, including aHash keeping only its first 32 bits.
 *
 * The result is compared against the sharp path in
 * tests/services/video-frame-fast-fingerprint.test.ts, which is what licenses using it.
 */
import type { PatchFingerprint } from '../../forensics/local-dna-patch-generator.service';

/** Rec.709 luma, matching sharp's greyscale conversion. */
function luma(r: number, g: number, b: number): number {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

/**
 * Greyscale a rectangle of a frame without copying it first — reads the frame buffer
 * with its own stride, which is why no per-patch allocation is needed.
 */
function greyRect(
  rgb: Buffer,
  frameWidth: number,
  left: number,
  top: number,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let src = ((top + y) * frameWidth + left) * 3;
    let dst = y * width;
    for (let x = 0; x < width; x++) {
      out[dst++] = luma(rgb[src]!, rgb[src + 1]!, rgb[src + 2]!);
      src += 3;
    }
  }
  return out;
}

/** Box-average downsample — the small-tile equivalent of an area resize. */
function boxResize(
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8Array {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return src;
  const out = new Uint8Array(dstWidth * dstHeight);
  for (let dy = 0; dy < dstHeight; dy++) {
    const y0 = Math.floor((dy * srcHeight) / dstHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * srcHeight) / dstHeight));
    for (let dx = 0; dx < dstWidth; dx++) {
      const x0 = Math.floor((dx * srcWidth) / dstWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * srcWidth) / dstWidth));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * srcWidth;
        for (let x = x0; x < x1; x++) {
          sum += src[row + x]!;
          count += 1;
        }
      }
      out[dy * dstWidth + dx] = Math.round(sum / Math.max(count, 1));
    }
  }
  return out;
}

/** Bits -> hex, the same packing the sharp path uses. */
function bitsToHex(bits: string, hexChars: number): string {
  let hex = '';
  for (let i = 0; i < hexChars * 4; i += 4) {
    hex += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
  }
  return hex.padStart(hexChars, '0');
}

function meanBits(grey: Uint8Array): string {
  let sum = 0;
  for (const v of grey) sum += v;
  const avg = sum / Math.max(grey.length, 1);
  let bits = '';
  for (const v of grey) bits += v >= avg ? '1' : '0';
  return bits;
}

function byteHex(value: number): string {
  return Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0');
}

/** All seven descriptors for one patch, in a single pass over its pixels. */
export function fingerprintRawPatchFast(params: {
  rgb: Buffer;
  frameWidth: number;
  left: number;
  top: number;
  width: number;
  height: number;
  patchIndex: number;
  gridX: number;
  gridY: number;
  scale: number;
}): PatchFingerprint {
  const { rgb, frameWidth, left, top, width, height } = params;
  const grey = greyRect(rgb, frameWidth, left, top, width, height);

  // pHash / aHash: 8x8 mean threshold. aHash keeps 32 bits, pHash all 64.
  const g8 = boxResize(grey, width, height, 8, 8);
  const bits64 = meanBits(g8);
  const pHash16 = bitsToHex(bits64, 16);
  const aHash8 = bitsToHex(bits64, 8);

  // dHash: 9x8, compare each pixel with its right neighbour (32 bits kept).
  const g98 = boxResize(grey, width, height, 9, 8);
  let dBits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = y * 9 + x;
      dBits += g98[i + 1]! > g98[i]! ? '1' : '0';
    }
  }
  const dHash8 = bitsToHex(dBits, 8);

  // Edge density over the full patch.
  let edges = 0;
  const edgeTotal = Math.max((height - 1) * (width - 1), 1);
  for (let y = 0; y < height - 1; y++) {
    const row = y * width;
    for (let x = 0; x < width - 1; x++) {
      const i = row + x;
      const gx = Math.abs(grey[i + 1]! - grey[i]!);
      const gy = Math.abs(grey[i + width]! - grey[i]!);
      if (gx + gy > 35) edges += 1;
    }
  }
  const edgeSignature = byteHex((edges / edgeTotal) * 255);

  // Colour: 4x4 box average, then the mean of those cells.
  let r = 0;
  let g = 0;
  let b = 0;
  let cells = 0;
  for (let cy = 0; cy < 4; cy++) {
    const y0 = Math.floor((cy * height) / 4);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / 4));
    for (let cx = 0; cx < 4; cx++) {
      const x0 = Math.floor((cx * width) / 4);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / 4));
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let src = ((top + y) * frameWidth + left + x0) * 3;
        for (let x = x0; x < x1; x++) {
          cr += rgb[src]!;
          cg += rgb[src + 1]!;
          cb += rgb[src + 2]!;
          src += 3;
          n += 1;
        }
      }
      r += cr / Math.max(n, 1);
      g += cg / Math.max(n, 1);
      b += cb / Math.max(n, 1);
      cells += 1;
    }
  }
  const colorVector: [number, number, number] = [
    Math.round(r / cells),
    Math.round(g / cells),
    Math.round(b / cells),
  ];

  // Frequency: standard deviation of a 16x16 reduction.
  const g16 = boxResize(grey, width, height, 16, 16);
  let mean = 0;
  for (const v of g16) mean += v;
  mean /= Math.max(g16.length, 1);
  let variance = 0;
  for (const v of g16) variance += (v - mean) ** 2;
  variance /= Math.max(g16.length, 1);
  const frequencySig = byteHex(Math.sqrt(variance));

  // Texture: mean absolute Laplacian of the 8x8 reduction.
  let laplacian = 0;
  let count = 0;
  for (let y = 1; y < 7; y++) {
    for (let x = 1; x < 7; x++) {
      const i = y * 8 + x;
      laplacian += Math.abs(4 * g8[i]! - g8[i - 1]! - g8[i + 1]! - g8[i - 8]! - g8[i + 8]!);
      count += 1;
    }
  }
  const textureSig = byteHex(laplacian / Math.max(count, 1));

  return {
    patchIndex: params.patchIndex,
    gridX: params.gridX,
    gridY: params.gridY,
    scale: params.scale,
    pHash16,
    dHash8,
    aHash8,
    edgeSignature,
    colorVector,
    frequencySig,
    textureSig,
  };
}
