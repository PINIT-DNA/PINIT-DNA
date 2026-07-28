/**
 * PINIT ownership watermark — spatial-block LSB tiling for crop survival.
 *
 * Embeds a compact ownership tile (vault/DNA id, user id, upload meta hash)
 * into every spatial block across the image so that even a ~20% crop /
 * fragment that still contains one full block can recover PinIT identity.
 *
 * Tile layout (64 bytes / 512 bits):
 *   0–3   magic "PNWM"
 *   4     version
 *   5     flags
 *   6–21  dnaFingerprint (SHA-256(dnaRecordId)[0:16])
 *   22–37 ownerFingerprint (SHA-256(ownerUserId)[0:16] or zeros)
 *   38–41 uploadedAt (unix seconds, BE uint32)
 *   42–49 metaHash (SHA-256(meta JSON)[0:8])
 *   50–63 seal (HMAC-SHA256(secret, bytes0..49)[0:14])
 *
 * Spatial block: 32×16 = 512 pixels (one full tile per block).
 */

import crypto from 'crypto';
import { config } from '../../config';

export const OWNERSHIP_WM_MAGIC = Buffer.from('PNWM');
export const OWNERSHIP_WM_VERSION = 1;
export const OWNERSHIP_TILE_BYTES = 64;
export const OWNERSHIP_TILE_BITS = OWNERSHIP_TILE_BYTES * 8; // 512
export const OWNERSHIP_BLOCK_W = 32;
export const OWNERSHIP_BLOCK_H = 16; // 32*16 = 512
export const OWNERSHIP_WM_ALGORITHM = 'ownership-watermark-v1';

export interface OwnershipWatermarkMeta {
  dnaRecordId: string;
  ownerUserId?: string | null;
  vaultId?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  uploadedAt?: Date | number | string | null;
  ip?: string | null;
  country?: string | null;
  city?: string | null;
  userAgent?: string | null;
  sessionToken?: string | null;
}

export interface OwnershipSignatureDetails {
  algorithm: typeof OWNERSHIP_WM_ALGORITHM;
  version: number;
  dnaRecordId: string;
  vaultId: string | null;
  ownerUserId: string | null;
  uploadedAt: string;
  filename: string | null;
  mimeType: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  userAgent: string | null;
  sessionToken: string | null;
  dnaFingerprint: string;
  ownerFingerprint: string;
  metaHash: string;
  tileHex: string;
  sealHex: string;
  tileBytes: number;
  tileBits: number;
  tileCount: number;
  capacityBits: number;
  usedBits: number;
  channel: 'B';
  blockWidth: number;
  blockHeight: number;
  cropSurvivalTarget: '20%+';
}

export interface OwnershipExtractResult {
  found: boolean;
  confidence: number;
  dnaFingerprint?: string;
  ownerFingerprint?: string;
  uploadedAt?: number;
  metaHash?: string;
  sealValid?: boolean;
  tileHex?: string;
  matchesScanned?: number;
}

function fp16(input: string): Buffer {
  return crypto.createHash('sha256').update(input).digest().subarray(0, 16);
}

function metaHash8(meta: OwnershipWatermarkMeta): Buffer {
  const payload = JSON.stringify({
    vaultId: meta.vaultId ?? null,
    filename: meta.filename ?? null,
    mimeType: meta.mimeType ?? null,
    ip: meta.ip ?? null,
    country: meta.country ?? null,
    city: meta.city ?? null,
    userAgent: meta.userAgent ?? null,
    sessionToken: meta.sessionToken ?? null,
  });
  return crypto.createHash('sha256').update(payload).digest().subarray(0, 8);
}

function toUnixSeconds(value: OwnershipWatermarkMeta['uploadedAt']): number {
  if (value == null) return Math.floor(Date.now() / 1000);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function computeSeal(tileWithoutSeal: Buffer, secret: string): Buffer {
  return crypto.createHmac('sha256', secret).update(tileWithoutSeal).digest().subarray(0, 14);
}

export function buildOwnershipTile(
  meta: OwnershipWatermarkMeta,
  secret: string = config.stego.signatureSecret,
): {
  tile: Buffer;
  details: Omit<
    OwnershipSignatureDetails,
    'tileCount' | 'capacityBits' | 'usedBits' | 'channel' | 'blockWidth' | 'blockHeight' | 'cropSurvivalTarget'
  >;
} {
  const uploadedAt = toUnixSeconds(meta.uploadedAt);
  const dnaFp = fp16(meta.dnaRecordId);
  const ownerFp = meta.ownerUserId ? fp16(meta.ownerUserId) : Buffer.alloc(16, 0);
  const metaH = metaHash8(meta);

  const head = Buffer.alloc(50);
  OWNERSHIP_WM_MAGIC.copy(head, 0);
  head[4] = OWNERSHIP_WM_VERSION;
  head[5] = meta.ownerUserId ? 0x01 : 0x00;
  dnaFp.copy(head, 6);
  ownerFp.copy(head, 22);
  head.writeUInt32BE(uploadedAt >>> 0, 38);
  metaH.copy(head, 42);

  const seal = computeSeal(head, secret);
  const tile = Buffer.concat([head, seal]);

  return {
    tile,
    details: {
      algorithm: OWNERSHIP_WM_ALGORITHM,
      version: OWNERSHIP_WM_VERSION,
      dnaRecordId: meta.dnaRecordId,
      vaultId: meta.vaultId ?? null,
      ownerUserId: meta.ownerUserId ?? null,
      uploadedAt: new Date(uploadedAt * 1000).toISOString(),
      filename: meta.filename ?? null,
      mimeType: meta.mimeType ?? null,
      ip: meta.ip ?? null,
      country: meta.country ?? null,
      city: meta.city ?? null,
      userAgent: meta.userAgent ?? null,
      sessionToken: meta.sessionToken ?? null,
      dnaFingerprint: dnaFp.toString('hex'),
      ownerFingerprint: ownerFp.toString('hex'),
      metaHash: metaH.toString('hex'),
      tileHex: tile.toString('hex'),
      sealHex: seal.toString('hex'),
      tileBytes: OWNERSHIP_TILE_BYTES,
      tileBits: OWNERSHIP_TILE_BITS,
    },
  };
}

function bufferToBits(buf: Buffer): number[] {
  const bits: number[] = [];
  for (const byte of buf) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits;
}

function bitsToBuffer(bits: number[]): Buffer {
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i * 8 + j] ?? 0);
    }
    out[i] = byte;
  }
  return out;
}

function embedTileInBlock(
  rgb: Buffer,
  width: number,
  blockX: number,
  blockY: number,
  tileBits: number[],
): void {
  let bitIdx = 0;
  for (let y = 0; y < OWNERSHIP_BLOCK_H; y++) {
    for (let x = 0; x < OWNERSHIP_BLOCK_W; x++) {
      const px = (blockY + y) * width + (blockX + x);
      const blueIdx = px * 3 + 2;
      rgb[blueIdx] = (rgb[blueIdx]! & 0xfe) | tileBits[bitIdx]!;
      bitIdx += 1;
    }
  }
}

function readBitsFromBlock(
  rgb: Buffer,
  width: number,
  blockX: number,
  blockY: number,
): number[] {
  const bits: number[] = [];
  for (let y = 0; y < OWNERSHIP_BLOCK_H; y++) {
    for (let x = 0; x < OWNERSHIP_BLOCK_W; x++) {
      const px = (blockY + y) * width + (blockX + x);
      bits.push(rgb[px * 3 + 2]! & 1);
    }
  }
  return bits;
}

function tryDecodeTileBits(bits: number[], secret: string): OwnershipExtractResult | null {
  if (bits.length < OWNERSHIP_TILE_BITS) return null;
  const tile = bitsToBuffer(bits.slice(0, OWNERSHIP_TILE_BITS));
  if (tile.length < OWNERSHIP_TILE_BYTES) return null;
  if (!tile.subarray(0, 4).equals(OWNERSHIP_WM_MAGIC)) return null;
  if (tile[4] !== OWNERSHIP_WM_VERSION) return null;

  const head = tile.subarray(0, 50);
  const seal = tile.subarray(50, 64);
  const expected = computeSeal(head, secret);
  const sealValid = seal.equals(expected);

  return {
    found: true,
    confidence: sealValid ? 1 : 0.55,
    dnaFingerprint: tile.subarray(6, 22).toString('hex'),
    ownerFingerprint: tile.subarray(22, 38).toString('hex'),
    uploadedAt: tile.readUInt32BE(38),
    metaHash: tile.subarray(42, 50).toString('hex'),
    sealValid,
    tileHex: tile.toString('hex'),
  };
}

/**
 * Embed ownership tile into every spatial 32×16 block across the image.
 */
export function embedOwnershipWatermark(
  rgb: Buffer,
  width: number,
  height: number,
  meta: OwnershipWatermarkMeta,
  secret: string = config.stego.signatureSecret,
): {
  rgb: Buffer;
  signature: OwnershipSignatureDetails;
} {
  const totalPixels = width * height;
  if (width < OWNERSHIP_BLOCK_W || height < OWNERSHIP_BLOCK_H) {
    throw new Error(
      `Image too small for ownership watermark: needs at least ${OWNERSHIP_BLOCK_W}×${OWNERSHIP_BLOCK_H}, has ${width}×${height}`,
    );
  }

  const { tile, details } = buildOwnershipTile(meta, secret);
  const tileBits = bufferToBits(tile);
  const carrier = Buffer.from(rgb);

  let tileCount = 0;
  for (let by = 0; by + OWNERSHIP_BLOCK_H <= height; by += OWNERSHIP_BLOCK_H) {
    for (let bx = 0; bx + OWNERSHIP_BLOCK_W <= width; bx += OWNERSHIP_BLOCK_W) {
      embedTileInBlock(carrier, width, bx, by, tileBits);
      tileCount += 1;
    }
  }

  if (tileCount < 1) {
    throw new Error('Failed to embed ownership watermark — no full blocks available');
  }

  return {
    rgb: carrier,
    signature: {
      ...details,
      tileCount,
      capacityBits: totalPixels,
      usedBits: tileCount * OWNERSHIP_TILE_BITS,
      channel: 'B',
      blockWidth: OWNERSHIP_BLOCK_W,
      blockHeight: OWNERSHIP_BLOCK_H,
      cropSurvivalTarget: '20%+',
    },
  };
}

/**
 * Recover ownership from a full image or crop/fragment.
 * Tries every possible block origin inside the fragment (handles arbitrary crop offsets).
 */
export function extractOwnershipWatermark(
  rgb: Buffer,
  width: number,
  height: number,
  secret: string = config.stego.signatureSecret,
): OwnershipExtractResult {
  if (width < OWNERSHIP_BLOCK_W || height < OWNERSHIP_BLOCK_H) {
    return { found: false, confidence: 0, matchesScanned: 0 };
  }

  let matchesScanned = 0;
  let best: OwnershipExtractResult | null = null;

  // Grid-aligned first (fast path for full protected files)
  for (let by = 0; by + OWNERSHIP_BLOCK_H <= height; by += OWNERSHIP_BLOCK_H) {
    for (let bx = 0; bx + OWNERSHIP_BLOCK_W <= width; bx += OWNERSHIP_BLOCK_W) {
      matchesScanned += 1;
      const bits = readBitsFromBlock(rgb, width, bx, by);
      const decoded = tryDecodeTileBits(bits, secret);
      if (!decoded?.found) continue;
      if (!best || decoded.confidence > (best.confidence ?? 0)) best = decoded;
      if (decoded.sealValid) return { ...decoded, matchesScanned };
    }
  }

  // Crop offset path: slide block origin by 1px (expensive but needed for fragments)
  const maxOx = Math.min(OWNERSHIP_BLOCK_W - 1, width - OWNERSHIP_BLOCK_W);
  const maxOy = Math.min(OWNERSHIP_BLOCK_H - 1, height - OWNERSHIP_BLOCK_H);
  for (let oy = 0; oy <= maxOy; oy++) {
    for (let ox = 0; ox <= maxOx; ox++) {
      if (ox === 0 && oy === 0) continue; // already scanned aligned
      for (let by = oy; by + OWNERSHIP_BLOCK_H <= height; by += OWNERSHIP_BLOCK_H) {
        for (let bx = ox; bx + OWNERSHIP_BLOCK_W <= width; bx += OWNERSHIP_BLOCK_W) {
          matchesScanned += 1;
          const bits = readBitsFromBlock(rgb, width, bx, by);
          const decoded = tryDecodeTileBits(bits, secret);
          if (!decoded?.found) continue;
          if (!best || decoded.confidence > (best.confidence ?? 0)) best = decoded;
          if (decoded.sealValid) return { ...decoded, matchesScanned };
        }
      }
    }
  }

  return best
    ? { ...best, matchesScanned }
    : { found: false, confidence: 0, matchesScanned };
}

export function ownershipPayloadHmac(
  tileHex: string,
  secret: string = config.stego.signatureSecret,
): string {
  return crypto.createHmac('sha256', secret).update(tileHex).digest('hex');
}
