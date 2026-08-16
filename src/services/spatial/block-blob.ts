/**
 * Spatial Auth Phase 1 — compact binary block-leaf blob
 *
 * Layout:
 *   magic "SPB1" (4)
 *   algoVersionLen u8 + utf8
 *   primaryScale u16 BE
 *   scaleCount u8
 *   for each scale (ascending):
 *     scale u16 BE
 *     blockCount u32 BE
 *     for each block (blockId ascending):
 *       blockId u32, x u16, y u16, w u16, h u16, tag[16]
 *
 * Phase 3F:
 * - Reject trailing bytes (offset MUST equal blob.length)
 * - Require canonical order (scale ASC, blockId ASC); do NOT repair by sorting
 * - Reject duplicate blockIds within a scale
 */

import { SPATIAL_BLOCK_BLOB_MAGIC, SPATIAL_TAG_BYTES } from './constants';
import { sortLeavesDeterministic } from './merkle';
import type { SpatialBlockLeaf } from './types';

export function encodeBlockBlob(params: {
  algorithmVersion: string;
  primaryScale: number;
  leaves: SpatialBlockLeaf[];
}): Buffer {
  const ordered = sortLeavesDeterministic(params.leaves);
  const byScale = new Map<number, SpatialBlockLeaf[]>();
  for (const leaf of ordered) {
    const list = byScale.get(leaf.scale) ?? [];
    list.push(leaf);
    byScale.set(leaf.scale, list);
  }
  const scales = [...byScale.keys()].sort((a, b) => a - b);

  const algoBuf = Buffer.from(params.algorithmVersion, 'utf8');
  if (algoBuf.length > 255) throw new Error('algorithmVersion too long');

  const chunks: Buffer[] = [];
  chunks.push(SPATIAL_BLOCK_BLOB_MAGIC);
  chunks.push(Buffer.from([algoBuf.length]));
  chunks.push(algoBuf);

  const primary = Buffer.alloc(2);
  primary.writeUInt16BE(params.primaryScale, 0);
  chunks.push(primary);
  chunks.push(Buffer.from([scales.length]));

  for (const scale of scales) {
    const leaves = byScale.get(scale)!;
    const hdr = Buffer.alloc(6);
    hdr.writeUInt16BE(scale, 0);
    hdr.writeUInt32BE(leaves.length, 2);
    chunks.push(hdr);

    for (const leaf of leaves) {
      if (leaf.tag.length !== SPATIAL_TAG_BYTES) {
        throw new Error(`Expected ${SPATIAL_TAG_BYTES}-byte tag, got ${leaf.tag.length}`);
      }
      const row = Buffer.alloc(12 + SPATIAL_TAG_BYTES);
      row.writeUInt32BE(leaf.blockId, 0);
      row.writeUInt16BE(leaf.x, 4);
      row.writeUInt16BE(leaf.y, 6);
      row.writeUInt16BE(leaf.width, 8);
      row.writeUInt16BE(leaf.height, 10);
      leaf.tag.copy(row, 12);
      chunks.push(row);
    }
  }

  return Buffer.concat(chunks);
}

export function decodeBlockBlob(blob: Buffer): {
  algorithmVersion: string;
  primaryScale: number;
  leaves: SpatialBlockLeaf[];
} {
  if (!blob || blob.length === 0) throw new Error('blockBlob empty');
  if (blob.length < 8) throw new Error('blockBlob too short');
  if (!blob.subarray(0, 4).equals(SPATIAL_BLOCK_BLOB_MAGIC)) {
    throw new Error('Invalid blockBlob magic');
  }

  let offset = 4;
  const algoLen = blob.readUInt8(offset);
  offset += 1;
  if (offset + algoLen > blob.length) throw new Error('Truncated blockBlob algorithmVersion');
  const algorithmVersion = blob.subarray(offset, offset + algoLen).toString('utf8');
  offset += algoLen;
  if (offset + 3 > blob.length) throw new Error('Truncated blockBlob header');
  const primaryScale = blob.readUInt16BE(offset);
  offset += 2;
  const scaleCount = blob.readUInt8(offset);
  offset += 1;

  const leaves: SpatialBlockLeaf[] = [];
  let prevScale = -1;
  for (let s = 0; s < scaleCount; s++) {
    if (offset + 6 > blob.length) throw new Error('Truncated blockBlob scale header');
    const scale = blob.readUInt16BE(offset);
    offset += 2;
    const blockCount = blob.readUInt32BE(offset);
    offset += 4;

    if (scale <= prevScale) {
      throw new Error('blockBlob scales not in canonical ascending order');
    }
    prevScale = scale;

    let prevBlockId = -1;
    const seen = new Set<number>();
    const rowSize = 12 + SPATIAL_TAG_BYTES;
    for (let i = 0; i < blockCount; i++) {
      if (offset + rowSize > blob.length) throw new Error('Truncated blockBlob leaf');
      const blockId = blob.readUInt32BE(offset);
      const x = blob.readUInt16BE(offset + 4);
      const y = blob.readUInt16BE(offset + 6);
      const width = blob.readUInt16BE(offset + 8);
      const height = blob.readUInt16BE(offset + 10);
      const tag = Buffer.from(blob.subarray(offset + 12, offset + 12 + SPATIAL_TAG_BYTES));
      offset += rowSize;

      if (seen.has(blockId)) throw new Error('Duplicate blockId in blockBlob');
      seen.add(blockId);
      if (blockId <= prevBlockId) {
        throw new Error('blockBlob blockIds not in canonical ascending order');
      }
      prevBlockId = blockId;

      leaves.push({ blockId, scale, x, y, width, height, tag });
    }
  }

  if (offset !== blob.length) {
    throw new Error(`Trailing bytes in blockBlob (offset=${offset}, length=${blob.length})`);
  }

  // Leaves are already canonical; do not re-sort attacker data
  return { algorithmVersion, primaryScale, leaves };
}
