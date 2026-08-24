/**
 * Phase 3A — compact pixel cell tag blob (SPX1)
 *
 * Layout:
 *   magic SPX1 (4)
 *   algoLen u8 + utf8
 *   schemeLen u8 + utf8
 *   cellSize u16 BE
 *   tagBytes u8
 *   cellCount u32 BE
 *   for each cell (cellId ascending):
 *     cellId u32, x u16, y u16, w u16, h u16, tag[tagBytes]
 *
 * Phase 3F:
 * - Reject trailing bytes (offset MUST equal blob.length)
 * - Require canonical cellId ascending order; do NOT repair by sorting
 * - Reject duplicate cellIds
 */

import { PIXEL_BLOB_MAGIC } from './constants';
import type { PixelCellLeaf } from './types';

export function sortPixelLeaves(leaves: PixelCellLeaf[]): PixelCellLeaf[] {
  return [...leaves].sort((a, b) => a.cellId - b.cellId);
}

export function encodePixelAuthBlob(params: {
  algorithmVersion: string;
  scheme: string;
  cellSize: number;
  tagBytes: number;
  leaves: PixelCellLeaf[];
}): Buffer {
  const ordered = sortPixelLeaves(params.leaves);
  const algo = Buffer.from(params.algorithmVersion, 'utf8');
  const scheme = Buffer.from(params.scheme, 'utf8');
  if (algo.length > 255 || scheme.length > 255) throw new Error('version/scheme too long');

  const chunks: Buffer[] = [PIXEL_BLOB_MAGIC, Buffer.from([algo.length]), algo, Buffer.from([scheme.length]), scheme];
  const hdr = Buffer.alloc(7);
  hdr.writeUInt16BE(params.cellSize, 0);
  hdr.writeUInt8(params.tagBytes, 2);
  hdr.writeUInt32BE(ordered.length, 3);
  chunks.push(hdr);

  for (const leaf of ordered) {
    if (leaf.tag.length !== params.tagBytes) {
      throw new Error(`Expected ${params.tagBytes}-byte tag, got ${leaf.tag.length}`);
    }
    const row = Buffer.alloc(12 + params.tagBytes);
    row.writeUInt32BE(leaf.cellId, 0);
    row.writeUInt16BE(leaf.x, 4);
    row.writeUInt16BE(leaf.y, 6);
    row.writeUInt16BE(leaf.width, 8);
    row.writeUInt16BE(leaf.height, 10);
    leaf.tag.copy(row, 12);
    chunks.push(row);
  }
  return Buffer.concat(chunks);
}

export function decodePixelAuthBlob(blob: Buffer): {
  algorithmVersion: string;
  scheme: string;
  cellSize: number;
  tagBytes: number;
  leaves: PixelCellLeaf[];
} {
  if (!blob || blob.length === 0) throw new Error('pixelAuthBlob empty');
  if (blob.length < 12 || !blob.subarray(0, 4).equals(PIXEL_BLOB_MAGIC)) {
    throw new Error('Invalid pixelAuthBlob');
  }
  let o = 4;
  if (o >= blob.length) throw new Error('Truncated pixelAuthBlob');
  const algoLen = blob.readUInt8(o); o += 1;
  if (o + algoLen > blob.length) throw new Error('Truncated pixelAuthBlob algorithmVersion');
  const algorithmVersion = blob.subarray(o, o + algoLen).toString('utf8'); o += algoLen;
  if (o >= blob.length) throw new Error('Truncated pixelAuthBlob');
  const schemeLen = blob.readUInt8(o); o += 1;
  if (o + schemeLen > blob.length) throw new Error('Truncated pixelAuthBlob scheme');
  const scheme = blob.subarray(o, o + schemeLen).toString('utf8'); o += schemeLen;
  if (o + 7 > blob.length) throw new Error('Truncated pixelAuthBlob header');
  const cellSize = blob.readUInt16BE(o); o += 2;
  const tagBytes = blob.readUInt8(o); o += 1;
  const cellCount = blob.readUInt32BE(o); o += 4;

  if (tagBytes !== 8 && tagBytes !== 16) {
    throw new Error(`Unsupported tagBytes in pixelAuthBlob: ${tagBytes}`);
  }

  const leaves: PixelCellLeaf[] = [];
  const rowSize = 12 + tagBytes;
  let prevCellId = -1;
  const seen = new Set<number>();

  for (let i = 0; i < cellCount; i++) {
    if (o + rowSize > blob.length) throw new Error('Truncated pixelAuthBlob');
    const cellId = blob.readUInt32BE(o);
    const x = blob.readUInt16BE(o + 4);
    const y = blob.readUInt16BE(o + 6);
    const width = blob.readUInt16BE(o + 8);
    const height = blob.readUInt16BE(o + 10);
    const tag = Buffer.from(blob.subarray(o + 12, o + 12 + tagBytes));
    o += rowSize;

    if (seen.has(cellId)) throw new Error('Duplicate cellId in pixelAuthBlob');
    seen.add(cellId);
    if (cellId <= prevCellId) {
      throw new Error('pixelAuthBlob cellIds not in canonical ascending order');
    }
    prevCellId = cellId;

    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    leaves.push({ cellId, cellX, cellY, x, y, width, height, tag });
  }

  if (o !== blob.length) {
    throw new Error(`Trailing bytes in pixelAuthBlob (offset=${o}, length=${blob.length})`);
  }

  // Already canonical — do not re-sort
  return { algorithmVersion, scheme, cellSize, tagBytes, leaves };
}
