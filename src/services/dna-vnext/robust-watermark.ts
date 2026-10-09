import sharp from 'sharp';
import {
  DNA_VNEXT_WATERMARK_VERSION,
  dnaVnextConfig,
  isDnaVnextEnabled,
} from '../../config/dna-vnext';
import { DNA_B_ROBUST } from '../../types/dna-vnext.types';
import type { RobustWatermarkRecovery } from '../../types/dna-vnext.types';
import { findProvenanceByLookupId } from './provenance';
import { findWatermarkCopy, recordWatermarkLookup } from './watermark-index';
import { signWatermarkBody, verifyWatermarkMac, watermarkLookupId, watermarkRecipientLookupId } from './crypto';

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

function fromBits1x(bits: number[], byteLen: number): Buffer | null {
  if (bits.length < byteLen * 8) return null;
  const out = Buffer.alloc(byteLen);
  for (let bi = 0; bi < byteLen * 8; bi++) {
    if (!bits[bi]) continue;
    const byteIndex = Math.floor(bi / 8);
    const shift = 7 - (bi % 8);
    out[byteIndex] = (out[byteIndex]! | (1 << shift)) & 0xff;
  }
  return out;
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
 * scheme survives JPEG because averaging over 128 pixels per half-tile
 * cancels per-pixel quantization noise instead of relying on one small
 * pixel neighborhood's coefficient surviving by luck.
 *
 * 2026-10-01: WM_DELTA=12 applied as a *solid* ±shift on every pixel of
 * each half-tile is JPEG-8×8 aligned (left/right halves are 8px wide in
 * canonical space) and reads as a full-image checkerboard on smooth
 * regions (fabric, walls, floors). The extractor only needs the *sign* of
 * the half-tile mean-luma difference, so the same Patchwork geometry is
 * kept with a texture-adaptive per-pixel delta. Smooth tiles (the dress /
 * wall / floor case) use ~1.5 luma so the 8px grid is below JND; textured
 * tiles still use up to the original strength of 12 so JPEG/resize recovery
 * keeps majority votes where the signal is already masked.
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
 * was applied in between. A second native block mark covers a crop that
 * still contains one whole block. Read-time also tries 90, 180 and 270
 * degree turns when the upright read fails.
 */
/** Canonical Patchwork geometry (must stay in lockstep with readBitFromTile). */
const TILE = 16;
const CANONICAL_LONG_SIDE = 1600;
/**
 * Per-pixel luma shift. Was a uniform 12 — that is ~4–6× JND on large
 * smooth patches and paints a visible 8px-column grid. Extractor uses only
 * the sign of (meanLeft − meanRight), plus 3× bits and multi-copy majority.
 */
const WM_DELTA_SMOOTH = 1.5;
const WM_DELTA_TEXTURE = 12;
const TEXTURE_STD_FLOOR = 2;
const TEXTURE_STD_CEIL = 10;
/** Support / confidence gate — not used for bit decisions. */
const SUPPORT_STRENGTH = 0.9;

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

function lumaAt(rgba: Buffer, width: number, x: number, y: number): number {
  const px = (y * width + x) * 4;
  return 0.299 * (rgba[px] ?? 0) + 0.587 * (rgba[px + 1] ?? 0) + 0.114 * (rgba[px + 2] ?? 0);
}

/**
 * Coarse (4×4 block-mean) luma stddev. Film grain / fine fabric noise has
 * high pixel std but low coarse std — that is exactly where a ±12 half-tile
 * step reads as a checkerboard. Edges and large-scale texture have high
 * coarse std and can hide the original Patchwork strength.
 */
function rectCoarseStd(rgba: Buffer, width: number, x0: number, y0: number, x1: number, y1: number): number {
  const gx = 4;
  const gy = 4;
  const means: number[] = [];
  for (let iy = 0; iy < gy; iy++) {
    const ya = y0 + Math.floor(((y1 - y0) * iy) / gy);
    const yb = y0 + Math.floor(((y1 - y0) * (iy + 1)) / gy);
    for (let ix = 0; ix < gx; ix++) {
      const xa = x0 + Math.floor(((x1 - x0) * ix) / gx);
      const xb = x0 + Math.floor(((x1 - x0) * (ix + 1)) / gx);
      if (xb <= xa || yb <= ya) continue;
      let s = 0;
      let n = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          s += lumaAt(rgba, width, x, y);
          n++;
        }
      }
      if (n) means.push(s / n);
    }
  }
  if (means.length < 2) return 0;
  const mu = means.reduce((a, b) => a + b, 0) / means.length;
  const varSum = means.reduce((a, b) => a + (b - mu) * (b - mu), 0) / means.length;
  return Math.sqrt(Math.max(0, varSum));
}

function adaptiveDelta(coarseStd: number): number {
  const t = Math.max(
    0,
    Math.min(1, (coarseStd - TEXTURE_STD_FLOOR) / (TEXTURE_STD_CEIL - TEXTURE_STD_FLOOR)),
  );
  return WM_DELTA_SMOOTH + t * (WM_DELTA_TEXTURE - WM_DELTA_SMOOTH);
}

/** Embed one bit into an arbitrary-size rectangle of the NATIVE image (proportional tile mapping). */
function embedBitInRect(rgba: Buffer, width: number, x0: number, y0: number, x1: number, y1: number, bit: number): void {
  const midX = (x0 + x1) / 2;
  const delta = adaptiveDelta(rectCoarseStd(rgba, width, x0, y0, x1, y1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const left = x < midX;
      const shift = (left === (bit === 1)) ? delta : -delta;
      const px = (y * width + x) * 4;
      rgba[px] = clamp((rgba[px] ?? 0) + shift);
      rgba[px + 1] = clamp((rgba[px + 1] ?? 0) + shift);
      rgba[px + 2] = clamp((rgba[px + 2] ?? 0) + shift);
    }
  }
}

/**
 * A second copy of the same payload, written as top-vs-bottom luma in fixed
 * 256px blocks. A crop that still contains one whole block can be read without
 * the full-frame grid. The shift is the same on the left and the right, so it
 * does not by itself flip the full-frame bits. Measured limit: JPEG quality 10
 * on a 2000×1500 image no longer recovers (see the A1 pin in the transcode test).
 */
const CROP_SIDE = 16;
const CROP_BLOCK = CROP_SIDE * TILE;
const CROP_DELTA = 10;

function embedBitTopBottom(rgba: Buffer, width: number, tx: number, ty: number, bit: number): void {
  const midY = ty + TILE / 2;
  for (let y = ty; y < ty + TILE; y++) {
    const shift = (y < midY) === (bit === 1) ? CROP_DELTA : -CROP_DELTA;
    for (let x = tx; x < tx + TILE; x++) {
      const px = (y * width + x) * 4;
      rgba[px] = clamp((rgba[px] ?? 0) + shift);
      rgba[px + 1] = clamp((rgba[px + 1] ?? 0) + shift);
      rgba[px + 2] = clamp((rgba[px + 2] ?? 0) + shift);
    }
  }
}

function embedCropBlocks(rgba: Buffer, width: number, height: number, bits: number[]): void {
  if (bits.length > CROP_SIDE * CROP_SIDE) return;
  if (width < CROP_BLOCK || height < CROP_BLOCK) return;
  const cols = Math.floor(width / CROP_BLOCK);
  const rows = Math.floor(height / CROP_BLOCK);
  const x0 = Math.floor((width - cols * CROP_BLOCK) / 2);
  const y0 = Math.floor((height - rows * CROP_BLOCK) / 2);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const bx = x0 + col * CROP_BLOCK;
      const by = y0 + row * CROP_BLOCK;
      let bitIdx = 0;
      for (let ty = 0; ty < CROP_SIDE; ty++) {
        for (let tx = 0; tx < CROP_SIDE; tx++) {
          const bit = bits[bitIdx] ?? 0;
          embedBitTopBottom(rgba, width, bx + tx * TILE, by + ty * TILE, bit);
          bitIdx++;
        }
      }
    }
  }
}

function readBitTopBottom(rgba: Buffer, width: number, tx: number, ty: number): number {
  let top = 0;
  let bottom = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const px = ((ty + y) * width + (tx + x)) * 4;
      const luma = 0.299 * (rgba[px] ?? 0) + 0.587 * (rgba[px + 1] ?? 0) + 0.114 * (rgba[px + 2] ?? 0);
      if (y < TILE / 2) top += luma;
      else bottom += luma;
    }
  }
  return top - bottom >= 0 ? 1 : 0;
}

function decodeCropBlock(rgba: Buffer, width: number, bx: number, by: number): string | null {
  const bits: number[] = [];
  for (let i = 0; i < 32; i++) {
    const tx = i % CROP_SIDE;
    const ty = Math.floor(i / CROP_SIDE);
    bits.push(readBitTopBottom(rgba, width, bx + tx * TILE, by + ty * TILE));
  }
  const magic = fromBits1x(bits, 4);
  if (!magic || magic.toString() !== 'PIT1') return null;
  for (let i = 32; i < CROP_SIDE * CROP_SIDE; i++) {
    const tx = i % CROP_SIDE;
    const ty = Math.floor(i / CROP_SIDE);
    bits.push(readBitTopBottom(rgba, width, bx + tx * TILE, by + ty * TILE));
  }
  const raw = fromBits1x(bits, 30);
  if (!raw) return null;
  return decodePayload(raw)?.lookupId ?? null;
}

function extractCropLookup(rgba: Buffer, width: number, height: number): string | null {
  if (width < CROP_BLOCK || height < CROP_BLOCK) return null;
  const cx = width / 2;
  const cy = height / 2;
  const candidates: Array<{ x: number; y: number }> = [];
  for (const phase of [0, 8]) {
    for (let y = phase; y + CROP_BLOCK <= height; y += TILE) {
      for (let x = phase; x + CROP_BLOCK <= width; x += TILE) {
        candidates.push({ x, y });
      }
    }
  }
  candidates.sort((a, b) => ((a.x - cx) ** 2 + (a.y - cy) ** 2) - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
  for (const c of candidates) {
    const hit = decodeCropBlock(rgba, width, c.x, c.y);
    if (hit) return hit;
  }
  return null;
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
 * header comment above the Patchwork delta constants for why this is resize-tolerant.
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
  embedCropBlocks(out, nativeWidth, nativeHeight, bits.filter((_, i) => i % 3 === 0));
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
    if (strength >= SUPPORT_STRENGTH) support.push(t);
  }
  return { bits, support };
}

export async function embedRobustProvenanceWatermark(params: {
  buffer: Buffer;
  mimeType: string;
  vaultId: string;
  dnaRecordId: string;
  ownerUserId?: string;
  recipientKey?: string;
  recipientLabel?: string;
}): Promise<{ buffer: Buffer; embedded: boolean; method: string; lookupId?: string }> {
  if (!isDnaVnextEnabled() || !dnaVnextConfig.watermarkOnProtectedDownload) {
    return { buffer: params.buffer, embedded: false, method: 'disabled' };
  }
  if (!params.mimeType.startsWith('image/')) {
    return { buffer: params.buffer, embedded: false, method: 'not-image' };
  }
  const lookup = params.recipientKey
    ? watermarkRecipientLookupId(params.vaultId, params.dnaRecordId, params.recipientKey)
    : watermarkLookupId(params.vaultId, params.dnaRecordId);
  const payload = encodePayload(lookup);
  const bits = toBits3x(payload);
  const { data, info } = await sharp(params.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (!canEmbedRobustWatermark(info.width, info.height)) {
    return { buffer: params.buffer, embedded: false, method: 'image-too-small' };
  }
  const rgba = embedBitsInRgba(data, info.width, info.height, bits);
  const format = params.mimeType.includes('png') ? 'png' : 'jpeg';
  const out = format === 'png'
    ? await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
    : await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();
  if (params.ownerUserId) {
    await recordWatermarkLookup({
      lookupId: lookup,
      vaultId: params.vaultId,
      dnaRecordId: params.dnaRecordId,
      ownerUserId: params.ownerUserId,
      recipientKey: params.recipientKey,
      recipientLabel: params.recipientLabel,
    });
  }
  return { buffer: out, embedded: true, method: DNA_VNEXT_WATERMARK_VERSION, lookupId: lookup };
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

type MarkHit = { lookupId: string; strengthPercent: number };

async function extractCanonicalMatch(buffer: Buffer): Promise<MarkHit | null> {
  const canon = await toCanonicalRaw(buffer);
  if (!canon) return null;
  const { bits, support } = readBitsFromRgba(canon.data, canon.cw, canon.ch);
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
  const lookupId = decodePayload(raw)?.lookupId;
  if (!lookupId) return null;
  const tiles = listTiles(canon.cw, canon.ch);
  const strengthPercent = tiles.length ? Math.round((support.length / tiles.length) * 100) : 0;
  return { lookupId, strengthPercent };
}

async function extractCropMatch(buffer: Buffer): Promise<MarkHit | null> {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) return null;
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lookupId = extractCropLookup(data, info.width, info.height);
  if (!lookupId) return null;
  return { lookupId, strengthPercent: 100 };
}

export async function extractWatermarkMatch(buffer: Buffer): Promise<MarkHit | null> {
  const direct = await extractCanonicalMatch(buffer);
  if (direct) return direct;
  const cropped = await extractCropMatch(buffer);
  if (cropped) return cropped;
  for (const angle of [90, 180, 270] as const) {
    const turned = await sharp(buffer).rotate(angle).toBuffer();
    const hit = await extractCanonicalMatch(turned) ?? await extractCropMatch(turned);
    if (hit) return hit;
  }
  return null;
}

export async function extractWatermarkLookupId(buffer: Buffer): Promise<string | null> {
  const hit = await extractWatermarkMatch(buffer);
  return hit?.lookupId ?? null;
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
    const hit = await extractWatermarkMatch(params.buffer);
    if (!hit) return emptyRecovery();
    const indexed = await findWatermarkCopy(hit.lookupId);
    if (indexed && indexed.ownerUserId !== params.ownerUserId) return emptyRecovery();
    let vaultId = indexed?.ownerUserId === params.ownerUserId ? indexed.vaultId : undefined;
    let dnaRecordId = indexed?.ownerUserId === params.ownerUserId ? indexed.dnaRecordId : undefined;
    let certificateId: string | null | undefined;
    if (!vaultId || !dnaRecordId) {
      const rec = await findProvenanceByLookupId({
        ownerUserId: params.ownerUserId,
        lookupId: hit.lookupId,
      });
      if (!rec) return emptyRecovery();
      vaultId = rec.vaultId;
      dnaRecordId = rec.dnaRecordId;
      certificateId = rec.certificateId;
    }
    return {
      recovered: true,
      mechanism: DNA_B_ROBUST,
      watermarkVersion: DNA_VNEXT_WATERMARK_VERSION,
      vaultId,
      dnaRecordId,
      certificateId,
      spatialConfidencePercent: hit.strengthPercent,
      doesNotImplyPixelCoverage: true,
    };
  } catch {
    return emptyRecovery();
  }
}
