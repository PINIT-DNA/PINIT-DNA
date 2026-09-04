import crypto from 'crypto';
import { blockDnaConfig } from '../../config/block-dna';

const PREFIX = Buffer.from('PINIT-BLOCK-DNA-v1', 'utf8');

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function derivedKey(): Buffer {
  return crypto.createHmac('sha256', blockDnaConfig.secret).update('pinit-block-dna-key-v1').digest();
}

/**
 * Coordinate-bound block DNA. Identical pixels at another (x,y) or another
 * image_id produce a different tag.
 */
export function computeBlockDnaHmac(params: {
  imageId: string;
  imageWidth: number;
  imageHeight: number;
  blockX: number;
  blockY: number;
  blockWidth: number;
  blockHeight: number;
  blockSize: number;
  version: number;
  blockRgb: Buffer;
}): Buffer {
  const message = Buffer.concat([
    PREFIX,
    Buffer.from(params.imageId, 'utf8'),
    u32be(params.imageWidth),
    u32be(params.imageHeight),
    u32be(params.blockSize),
    u32be(params.blockX),
    u32be(params.blockY),
    u32be(params.blockWidth),
    u32be(params.blockHeight),
    u32be(params.version),
    params.blockRgb,
  ]);
  return crypto.createHmac('sha256', derivedKey()).update(message).digest();
}

export function hmacEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function truncateDnaHex(tag: Buffer, chars = blockDnaConfig.publicDnaHexChars): string {
  return tag.subarray(0, Math.ceil(chars / 2)).toString('hex').slice(0, chars);
}
