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

const COEFF_IDXS = [8 * 16 + 9, 8 * 16 + 10, 9 * 16 + 8, 9 * 16 + 9];

function listTiles(width: number, height: number): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let by = 0; by + 16 <= height; by += 16) {
    for (let bx = 0; bx + 16 <= width; bx += 16) {
      tiles.push({ x: bx, y: by });
    }
  }
  return tiles;
}

function embedBitsInRgba(rgba: Buffer, width: number, height: number, bits: number[]): Buffer {
  const out = Buffer.from(rgba);
  const tiles = listTiles(width, height);
  let bitIdx = 0;
  for (const t of tiles) {
    const block = extractLumaBlock16(out, width, t.x, t.y);
    const haar = haar1Level(block);
    for (const idx of COEFF_IDXS) {
      if (bitIdx >= bits.length) bitIdx = 0;
      const bit = bits[bitIdx]!;
      haar[idx] = bit ? Math.abs(haar[idx]!) + 8 : -(Math.abs(haar[idx]!) + 8);
      bitIdx++;
    }
    applyLumaBlock16(out, width, t.x, t.y, inverseHaar1Level(haar));
  }
  return out;
}

function readBitsFromRgba(rgba: Buffer, width: number, height: number): {
  bits: number[];
  support: Array<{ x: number; y: number }>;
} {
  const tiles = listTiles(width, height);
  const bits: number[] = [];
  const support: Array<{ x: number; y: number }> = [];
  for (const t of tiles) {
    const haar = haar1Level(extractLumaBlock16(rgba, width, t.x, t.y));
    let strong = 0;
    for (const idx of COEFF_IDXS) {
      const v = haar[idx] ?? 0;
      bits.push(v >= 0 ? 1 : 0);
      if (Math.abs(v) >= 4) strong++;
    }
    if (strong >= 2) support.push(t);
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
  if (listTiles(info.width, info.height).length * COEFF_IDXS.length < bits.length) {
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
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { bits } = readBitsFromRgba(data, info.width, info.height);
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
    const { data, info } = await sharp(params.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { bits, support } = readBitsFromRgba(data, info.width, info.height);
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

    const tiles = listTiles(info.width, info.height);
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
