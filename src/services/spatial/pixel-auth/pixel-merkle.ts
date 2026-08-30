/**
 * Phase 3A — Merkle over pixel cell leaves + separate pixel root MAC
 * Phase 3F: pixel root MAC payload encoding versioned
 */

import crypto from 'crypto';
import { PIXEL_LEAF_PREFIX } from './constants';
import { deriveSpatialPixelRootMacKey } from './key-derivation';
import { sortPixelLeaves } from './pixel-blob';
import {
  buildCryptoPayload,
  encodingForSpatialPixelVersion,
} from '../crypto-encoding';
import type { PixelCellLeaf } from './types';

function u16be(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}
function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

export function hashPixelLeaf(leaf: PixelCellLeaf): Buffer {
  return crypto
    .createHash('sha256')
    .update(PIXEL_LEAF_PREFIX)
    .update(u32be(leaf.cellId))
    .update(u16be(leaf.x))
    .update(u16be(leaf.y))
    .update(u16be(leaf.width))
    .update(u16be(leaf.height))
    .update(leaf.tag)
    .digest();
}

export function computePixelMerkleRoot(leaves: PixelCellLeaf[]): Buffer {
  const ordered = sortPixelLeaves(leaves);
  if (ordered.length === 0) {
    return crypto.createHash('sha256').update(Buffer.from('SPATIAL-PIXEL-EMPTY-ROOT-v1')).digest();
  }
  let level = ordered.map(hashPixelLeaf);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) next.push(level[i]!);
      else next.push(crypto.createHash('sha256').update(level[i]!).update(level[i + 1]!).digest());
    }
    level = next;
  }
  return level[0]!;
}

export function pixelMerkleRootHex(leaves: PixelCellLeaf[]): string {
  return computePixelMerkleRoot(leaves).toString('hex');
}

export function computePixelRootMac(params: {
  dnaRecordId: string;
  ownerUserId: string;
  width: number;
  height: number;
  orientationPolicy: string;
  globalDnaRef: string;
  keyId: string;
  algorithmVersion: string;
  scheme: string;
  cellSize: number;
  tagBytes: number;
  pixelAuthRootHex: string;
  masterSecret?: string;
}): string {
  const key = deriveSpatialPixelRootMacKey({
    dnaRecordId: params.dnaRecordId,
    keyId: params.keyId,
    masterSecret: params.masterSecret,
    algorithmVersion: params.algorithmVersion,
  });
  const encoding = encodingForSpatialPixelVersion(params.algorithmVersion);

  let payload: Buffer;
  if (encoding === 'pipe-v1') {
    payload = buildCryptoPayload(encoding, 'PIXEL-ROOT-MAC-v1', [
      { type: 'str', value: params.keyId },
      { type: 'str', value: params.algorithmVersion },
      { type: 'str', value: params.scheme },
      { type: 'str', value: params.dnaRecordId },
      { type: 'str', value: params.ownerUserId },
      { type: 'str', value: String(params.width) },
      { type: 'str', value: String(params.height) },
      { type: 'str', value: params.orientationPolicy },
      { type: 'str', value: params.globalDnaRef },
      { type: 'str', value: String(params.cellSize) },
      { type: 'str', value: String(params.tagBytes) },
      { type: 'str', value: params.pixelAuthRootHex },
    ]);
  } else {
    payload = buildCryptoPayload(encoding, 'PIXEL-ROOT-MAC-v1', [
      { type: 'str', value: params.keyId },
      { type: 'str', value: params.algorithmVersion },
      { type: 'str', value: params.scheme },
      { type: 'str', value: params.dnaRecordId },
      { type: 'str', value: params.ownerUserId },
      { type: 'u32', value: params.width },
      { type: 'u32', value: params.height },
      { type: 'str', value: params.orientationPolicy },
      { type: 'str', value: params.globalDnaRef },
      { type: 'u16', value: params.cellSize },
      { type: 'u16', value: params.tagBytes },
      { type: 'str', value: params.pixelAuthRootHex },
    ]);
  }

  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

export function verifyPixelRootMac(
  params: Parameters<typeof computePixelRootMac>[0] & { pixelRootMac: string },
): boolean {
  const expected = computePixelRootMac(params);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(params.pixelRootMac, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}
