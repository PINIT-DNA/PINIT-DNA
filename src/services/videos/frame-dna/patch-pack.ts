/**
 * Compact binary encoding for multi-scale patch fingerprints (video frame DNA).
 *
 * A protected frame used to store ~2,465 LocalDnaPatch rows at ~203 bytes each plus
 * four B-tree indexes. The information in one patch is 30 bytes, so the whole grid
 * packs into a single bytea column and decodes back to the exact same
 * PatchFingerprint values the matchers already consume.
 *
 * Layout (little-endian), format PFP1:
 *   magic "PFP1" (4) | patchCount u32 (4)
 *   per patch (30):
 *     patchIndex u16 | gridX u16 | gridY u16 | scale u16 |
 *     pHash16 8B | dHash8 4B | aHash8 4B |
 *     edgeSignature u8 | frequencySig u8 | textureSig u8 | r u8 | g u8 | b u8
 *
 * Encoding is lossless for every value the generator produces; anything out of range
 * throws instead of being silently truncated. Trailing bytes are rejected on decode.
 */
import type { PatchFingerprint } from '../../forensics/local-dna-patch-generator.service';

export const PATCH_PACK_VERSION = 'PFP1';
const MAGIC = Buffer.from(PATCH_PACK_VERSION, 'ascii');
const HEADER_BYTES = 8;
export const PATCH_PACK_BYTES_PER_PATCH = 30;

function u16(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`patch-pack: ${field} out of u16 range: ${value}`);
  }
  return value;
}

function u8(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`patch-pack: ${field} out of u8 range: ${value}`);
  }
  return value;
}

function hexBytes(hex: string, bytes: number, field: string): Buffer {
  if (typeof hex !== 'string' || hex.length !== bytes * 2 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error(`patch-pack: ${field} must be ${bytes * 2} lowercase hex chars, got "${hex}"`);
  }
  return Buffer.from(hex, 'hex');
}

export function encodePatchPack(patches: readonly PatchFingerprint[]): Buffer {
  const out = Buffer.alloc(HEADER_BYTES + patches.length * PATCH_PACK_BYTES_PER_PATCH);
  MAGIC.copy(out, 0);
  out.writeUInt32LE(patches.length, 4);

  let o = HEADER_BYTES;
  for (const p of patches) {
    out.writeUInt16LE(u16(p.patchIndex, 'patchIndex'), o);
    out.writeUInt16LE(u16(p.gridX, 'gridX'), o + 2);
    out.writeUInt16LE(u16(p.gridY, 'gridY'), o + 4);
    out.writeUInt16LE(u16(p.scale, 'scale'), o + 6);
    hexBytes(p.pHash16, 8, 'pHash16').copy(out, o + 8);
    hexBytes(p.dHash8, 4, 'dHash8').copy(out, o + 16);
    hexBytes(p.aHash8, 4, 'aHash8').copy(out, o + 20);
    out.writeUInt8(hexBytes(p.edgeSignature, 1, 'edgeSignature')[0]!, o + 24);
    out.writeUInt8(hexBytes(p.frequencySig, 1, 'frequencySig')[0]!, o + 25);
    out.writeUInt8(hexBytes(p.textureSig, 1, 'textureSig')[0]!, o + 26);
    out.writeUInt8(u8(p.colorVector[0], 'colorVector.r'), o + 27);
    out.writeUInt8(u8(p.colorVector[1], 'colorVector.g'), o + 28);
    out.writeUInt8(u8(p.colorVector[2], 'colorVector.b'), o + 29);
    o += PATCH_PACK_BYTES_PER_PATCH;
  }
  return out;
}

export function decodePatchPack(blob: Buffer | Uint8Array): PatchFingerprint[] {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length < HEADER_BYTES || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('patch-pack: not a PFP1 blob');
  }
  const count = buf.readUInt32LE(4);
  const expected = HEADER_BYTES + count * PATCH_PACK_BYTES_PER_PATCH;
  if (buf.length !== expected) {
    throw new Error(`patch-pack: length ${buf.length} does not match ${count} patches (${expected})`);
  }

  const patches: PatchFingerprint[] = new Array(count);
  let o = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    patches[i] = {
      patchIndex: buf.readUInt16LE(o),
      gridX: buf.readUInt16LE(o + 2),
      gridY: buf.readUInt16LE(o + 4),
      scale: buf.readUInt16LE(o + 6),
      pHash16: buf.toString('hex', o + 8, o + 16),
      dHash8: buf.toString('hex', o + 16, o + 20),
      aHash8: buf.toString('hex', o + 20, o + 24),
      edgeSignature: buf.toString('hex', o + 24, o + 25),
      frequencySig: buf.toString('hex', o + 25, o + 26),
      textureSig: buf.toString('hex', o + 26, o + 27),
      colorVector: [buf.readUInt8(o + 27), buf.readUInt8(o + 28), buf.readUInt8(o + 29)],
    };
    o += PATCH_PACK_BYTES_PER_PATCH;
  }
  return patches;
}
