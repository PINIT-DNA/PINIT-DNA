import sharp from 'sharp';
import {
  DNA_VNEXT_WATERMARK_VERSION,
  dnaVnextConfig,
  isDnaVnextEnabled,
} from '../../config/dna-vnext';
import { DNA_B_ROBUST } from '../../types/dna-vnext.types';
import type { RobustWatermarkRecovery } from '../../types/dna-vnext.types';
import { findProvenanceByLookupId } from './provenance';
import { signWatermarkBody, verifyWatermarkMac, watermarkLookupId } from './crypto';

const MAGIC = Buffer.from('PIT1');

function encodePayload(lookupIdHex: string): Buffer {
  const lookup = Buffer.from(lookupIdHex, 'hex');
  if (lookup.length !== 8) throw new Error('lookup id must be 8 bytes');
  const body = Buffer.concat([MAGIC, Buffer.from([1]), lookup, Buffer.from([0])]);
  const mac = signWatermarkBody(body);
  return Buffer.concat([body, mac]);
}

function decodePayload(raw: Buffer): { lookupId: string } | null {
  if (raw.length < 30) return null;
  if (raw.subarray(0, 4).toString() !== 'PIT1') return null;
  if (raw[4] !== 1) return null;
  const body = raw.subarray(0, 14);
  const mac = raw.subarray(14, 30);
  if (!verifyWatermarkMac(body, mac)) return null;
  return { lookupId: raw.subarray(5, 13).toString('hex') };
}

function toBits3x(data: Buffer): number[] {
  const bits: number[] = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i--) {
      const b = (byte >> i) & 1;
      bits.push(b, b, b);
    }
  }
  return bits;
}

function fromBits3x(bits: number[], byteLen: number): Buffer | null {
  const need = byteLen * 8 * 3;
  if (bits.length < need) return null;
  const out = Buffer.alloc(byteLen);
  for (let bi = 0; bi < byteLen * 8; bi++) {
    const i = bi * 3;
    const votes = (bits[i] ?? 0) + (bits[i + 1] ?? 0) + (bits[i + 2] ?? 0);
    const bit = votes >= 2 ? 1 : 0;
    const byteIndex = Math.floor(bi / 8);
    const shift = 7 - (bi % 8);
    out[byteIndex] = (out[byteIndex]! | (bit << shift)) & 0xff;
  }
  return out;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Half-tile mean-luma difference ("Patchwork" watermarking) — one bit per
 * 16x16 tile, encoded as a small push toward the left half for bit=1 (right
 * half for bit=0), redistributing luma rather than shifting it (the tile's
 * overall mean is preserved, so it doesn't fight brightness/contrast edits).
 *
 * Replaced an earlier single-Haar-coefficient scheme that only survived a
 * lossless copy. Measured (tests/watermark/robust-watermark-transcode.test.ts):
 * that scheme needed a visually destructive delta (~180 on a 0-255 luma
 * scale) to survive JPEG q30, and never survived resize at any delta. This
 * scheme survives JPEG at every tested quality (q90 down to q10) at
 * WM_DELTA=12 — 15x smaller than that destructive threshold — because
 * averaging over 128 pixels per half-tile cancels per-pixel quantization
 * noise instead of relying on one small pixel neighborhood's coefficient
 * surviving by luck.
 *
 * Resize tolerance (2026-09-23): tiles used to be addressed by absolute
 * native pixel position, so resizing the image changed the tile grid
 * entirely and bit N no longer landed on the tile it was written to — a
 * structural addressing problem, not a magnitude one. Fixed by defining the
 * tile grid in a resolution-independent CANONICAL frame (aspect-ratio
 * preserved, long side = CANONICAL_LONG_SIDE) instead of native pixels:
 * embedding maps each canonical tile to a proportional rectangle in the
 * NATIVE image (no forced resize, no embed-time quality cost — see
 * embedBitInRect), while extraction resizes the incoming buffer to that
 * same canonical size FIRST (see canonicalDims), then reads with the
 * unchanged fixed-pixel tile code. Because canonical dimensions depend only
 * on aspect ratio, and a uniform resize preserves aspect ratio, embed-time
 * and extract-time derive the same grid regardless of what resize factor
 * was applied in between. Covers uniform, aspect-ratio-preserving resize
 * only — crop and non-uniform stretch are ORB's job, not this layer's (see
 * the multi-layer agreement gate, which treats them as separate signals).
 */
const WM_DELTA = 12;
const TILE = 16;
const CANONICAL_LONG_SIDE = 1600;

function listTiles(width: number, height: number): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let by = 0; by + TILE <= height; by += TILE) {
    for (let bx = 0; bx + TILE <= width; bx += TILE) {
      tiles.push({ x: bx, y: by });
    }
  }
  return tiles;
}

/**
 * The resolution-independent reference frame tile positions are defined in.
 * Long side fixed at CANONICAL_LONG_SIDE, short side proportional to the
 * image's own aspect ratio, both snapped down to a multiple of TILE for a
 * clean grid. Aspect ratio survives a uniform resize, so this returns the
 * same canonical size for an image and any uniformly-resized copy of it.
 */
function canonicalDims(width: number, height: number): { cw: number; ch: number } {
  const snap = (v: number) => Math.max(TILE, Math.floor(v / TILE) * TILE);
  if (width >= height) {
    const cw = snap(CANONICAL_LONG_SIDE);
    const ch = snap(CANONICAL_LONG_SIDE * (height / width));
    return { cw, ch };
  }
  const ch = snap(CANONICAL_LONG_SIDE);
  const cw = snap(CANONICAL_LONG_SIDE * (width / height));
  return { cw, ch };
}

/** Payload is 30 bytes, 3x bit redundancy -> 720 tiles needed for one full copy. */
const PAYLOAD_MIN_TILES = 30 * 8 * 3;

/**
 * Minimum native size below which proportional tile rectangles would round
 * to near-nothing (embedding into a 40x40 thumbnail via extreme upscaling
 * to canonical space is meaningless — there's no real detail to carry it).
 */
const MIN_NATIVE_LONG_SIDE = 200;

/**
 * Can this image size carry the watermark at all — pure dimension math, no
 * vaultId/dnaRecordId needed. Used at DNA-generation time (before a vaultId
 * exists) to honestly record whether a file is even capable of it, without
 * pretending to have embedded anything yet — the real embed only happens
 * later, at protected-download / share-link delivery (embedRobustProvenanceWatermark).
 *
 * Capacity is now measured in the CANONICAL frame (always ample — a few
 * thousand tiles at CANONICAL_LONG_SIDE=1600 — since embedding no longer
 * depends on native resolution), gated by a sane minimum native size.
 */
export function canEmbedRobustWatermark(width: number, height: number): boolean {
  if (Math.max(width, height) < MIN_NATIVE_LONG_SIDE) return false;
  const { cw, ch } = canonicalDims(width, height);
  return listTiles(cw, ch).length >= PAYLOAD_MIN_TILES;
}

/** Embed one bit into an arbitrary-size rectangle of the NATIVE image (proportional tile mapping). */
function embedBitInRect(rgba: Buffer, width: number, x0: number, y0: number, x1: number, y1: number, bit: number): void {
  const midX = (x0 + x1) / 2;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const left = x < midX;
      const shift = (left === (bit === 1)) ? WM_DELTA : -WM_DELTA;
      const px = (y * width + x) * 4;
      rgba[px] = clamp((rgba[px] ?? 0) + shift);
      rgba[px + 1] = clamp((rgba[px + 1] ?? 0) + shift);
      rgba[px + 2] = clamp((rgba[px + 2] ?? 0) + shift);
    }
  }
}

function readBitFromTile(rgba: Buffer, width: number, tx: number, ty: number): { bit: number; strength: number } {
  let leftSum = 0, rightSum = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const px = ((ty + y) * width + (tx + x)) * 4;
      const luma = 0.299 * (rgba[px] ?? 0) + 0.587 * (rgba[px + 1] ?? 0) + 0.114 * (rgba[px + 2] ?? 0);
      if (x < TILE / 2) leftSum += luma; else rightSum += luma;
    }
  }
  const diff = leftSum - rightSum;
  return { bit: diff >= 0 ? 1 : 0, strength: Math.abs(diff) / (TILE * TILE / 2) };
}

/**
 * Embeds into the NATIVE-resolution buffer (no forced resize) by mapping
 * each CANONICAL tile to a proportional native-pixel rectangle — see the
 * header comment above WM_DELTA for why this is resize-tolerant.
 */
function embedBitsInRgba(rgba: Buffer, nativeWidth: number, nativeHeight: number, bits: number[]): Buffer {
  const out = Buffer.from(rgba);
  const { cw, ch } = canonicalDims(nativeWidth, nativeHeight);
  const canonicalTiles = listTiles(cw, ch);
  const scaleX = nativeWidth / cw;
  const scaleY = nativeHeight / ch;
  let bitIdx = 0;
  for (const t of canonicalTiles) {
    if (bitIdx >= bits.length) bitIdx = 0;
    const x0 = Math.round(t.x * scaleX);
    const x1 = Math.min(nativeWidth, Math.round((t.x + TILE) * scaleX));
    const y0 = Math.round(t.y * scaleY);
    const y1 = Math.min(nativeHeight, Math.round((t.y + TILE) * scaleY));
    if (x1 > x0 && y1 > y0) {
      embedBitInRect(out, nativeWidth, x0, y0, x1, y1, bits[bitIdx]!);
    }
    bitIdx++;
  }
  return out;
}

/** Resizes to the canonical frame (aspect-ratio-derived from the buffer's own dimensions) and returns raw RGBA at that size — the read-side counterpart to embedBitsInRgba's write-side mapping. */
async function toCanonicalRaw(buffer: Buffer): Promise<{ data: Buffer; cw: number; ch: number } | null> {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) return null;
  const { cw, ch } = canonicalDims(meta.width, meta.height);
  const { data } = await sharp(buffer)
    .resize(cw, ch, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, cw, ch };
}

function readBitsFromRgba(rgba: Buffer, width: number, height: number): {
  bits: number[];
  support: Array<{ x: number; y: number }>;
} {
  const tiles = listTiles(width, height);
  const bits: number[] = [];
  const support: Array<{ x: number; y: number }> = [];
  for (const t of tiles) {
    const { bit, strength } = readBitFromTile(rgba, width, t.x, t.y);
    bits.push(bit);
    if (strength >= WM_DELTA / 2) support.push(t);
  }
  return { bits, support };
}

export async function embedRobustProvenanceWatermark(params: {
  buffer: Buffer;
  mimeType: string;
  vaultId: string;
  dnaRecordId: string;
}): Promise<{ buffer: Buffer; embedded: boolean; method: string }> {
  if (!isDnaVnextEnabled() || !dnaVnextConfig.watermarkOnProtectedDownload) {
    return { buffer: params.buffer, embedded: false, method: 'disabled' };
  }
  if (!params.mimeType.startsWith('image/')) {
    return { buffer: params.buffer, embedded: false, method: 'not-image' };
  }
  const lookup = watermarkLookupId(params.vaultId, params.dnaRecordId);
  const payload = encodePayload(lookup);
  const bits = toBits3x(payload);
  const { data, info } = await sharp(params.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (!canEmbedRobustWatermark(info.width, info.height)) {
    return { buffer: params.buffer, embedded: false, method: 'image-too-small' };
  }
  const rgba = embedBitsInRgba(data, info.width, info.height, bits);
  const format = params.mimeType.includes('png') ? 'png' : 'jpeg';
  const out = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).toFormat(format).toBuffer();
  return { buffer: out, embedded: true, method: DNA_VNEXT_WATERMARK_VERSION };
}

function emptyRecovery(): RobustWatermarkRecovery {
  return {
    recovered: false,
    mechanism: DNA_B_ROBUST,
    watermarkVersion: DNA_VNEXT_WATERMARK_VERSION,
    spatialConfidencePercent: 0,
    doesNotImplyPixelCoverage: true,
  };
}

export async function extractWatermarkLookupId(buffer: Buffer): Promise<string | null> {
  const canon = await toCanonicalRaw(buffer);
  if (!canon) return null;
  const { bits } = readBitsFromRgba(canon.data, canon.cw, canon.ch);
  const payloadLen = 30;
  const cycle = payloadLen * 8 * 3;
  if (bits.length < cycle) return null;
  const copies = Math.floor(bits.length / cycle);
  const acc = new Array<number>(cycle).fill(0);
  for (let c = 0; c < copies; c++) {
    for (let i = 0; i < cycle; i++) acc[i]! += bits[c * cycle + i] ?? 0;
  }
  const majority = acc.map((v) => (v >= Math.ceil(copies / 2) ? 1 : 0));
  const raw = fromBits3x(majority, payloadLen);
  if (!raw) return null;
  return decodePayload(raw)?.lookupId ?? null;
}

export async function recoverRobustProvenanceWatermark(params: {
  buffer: Buffer;
  mimeType: string;
  ownerUserId: string;
}): Promise<RobustWatermarkRecovery> {
  if (!isDnaVnextEnabled() || !params.mimeType.startsWith('image/')) {
    return emptyRecovery();
  }
  try {
    const canon = await toCanonicalRaw(params.buffer);
    if (!canon) return emptyRecovery();
    const { bits, support } = readBitsFromRgba(canon.data, canon.cw, canon.ch);
    const payloadLen = 30;
    const cycle = payloadLen * 8 * 3;
    if (bits.length < cycle) return emptyRecovery();
    const copies = Math.floor(bits.length / cycle);
    const acc = new Array<number>(cycle).fill(0);
    for (let c = 0; c < copies; c++) {
      for (let i = 0; i < cycle; i++) acc[i]! += bits[c * cycle + i] ?? 0;
    }
    const majority = acc.map((v) => (v >= Math.ceil(copies / 2) ? 1 : 0));
    const raw = fromBits3x(majority, payloadLen);
    if (!raw) return emptyRecovery();
    const decoded = decodePayload(raw);
    if (!decoded) return emptyRecovery();
    const rec = await findProvenanceByLookupId({
      ownerUserId: params.ownerUserId,
      lookupId: decoded.lookupId,
    });
    if (!rec) return emptyRecovery();

    const tiles = listTiles(canon.cw, canon.ch);
    const conf = tiles.length ? Math.round((support.length / tiles.length) * 100) : 0;
    let supportRegion: RobustWatermarkRecovery['supportRegion'];
    if (support.length) {
      const xs = support.map((s) => s.x);
      const ys = support.map((s) => s.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs) + 16;
      const maxY = Math.max(...ys) + 16;
      supportRegion = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    return {
      recovered: true,
      mechanism: DNA_B_ROBUST,
      watermarkVersion: DNA_VNEXT_WATERMARK_VERSION,
      vaultId: rec.vaultId,
      dnaRecordId: rec.dnaRecordId,
      certificateId: rec.certificateId,
      spatialConfidencePercent: conf,
      supportRegion,
      doesNotImplyPixelCoverage: true,
    };
  } catch {
    return emptyRecovery();
  }
}
