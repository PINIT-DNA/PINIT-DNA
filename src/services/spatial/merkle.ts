/**
 * Spatial Auth Phase 1 — deterministic Merkle tree over block auth leaves
 */

import crypto from 'crypto';
import { SPATIAL_LEAF_PREFIX } from './constants';
import { deriveSpatialRootMacKey } from './key-derivation';
import {
  buildCryptoPayload,
  encodingForSpatialAuthVersion,
} from './crypto-encoding';
import type { SpatialBlockLeaf } from './types';

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

/** Stable sort: scale ASC, then blockId ASC */
export function sortLeavesDeterministic(leaves: SpatialBlockLeaf[]): SpatialBlockLeaf[] {
  return [...leaves].sort((a, b) => {
    if (a.scale !== b.scale) return a.scale - b.scale;
    return a.blockId - b.blockId;
  });
}

export function hashSpatialLeaf(leaf: SpatialBlockLeaf): Buffer {
  return crypto
    .createHash('sha256')
    .update(SPATIAL_LEAF_PREFIX)
    .update(u16be(leaf.scale))
    .update(u32be(leaf.blockId))
    .update(u16be(leaf.x))
    .update(u16be(leaf.y))
    .update(u16be(leaf.width))
    .update(u16be(leaf.height))
    .update(leaf.tag)
    .digest();
}

/**
 * Pairwise Merkle: SHA256(left || right).
 * Odd node at a level is promoted unchanged (no duplication).
 */
export function computeMerkleRoot(leaves: SpatialBlockLeaf[]): Buffer {
  const ordered = sortLeavesDeterministic(leaves);
  if (ordered.length === 0) {
    return crypto.createHash('sha256').update(Buffer.from('SPATIAL-EMPTY-ROOT-v1')).digest();
  }

  let level = ordered.map(hashSpatialLeaf);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) {
        next.push(level[i]!);
      } else {
        next.push(
          crypto.createHash('sha256').update(level[i]!).update(level[i + 1]!).digest(),
        );
      }
    }
    level = next;
  }
  return level[0]!;
}

export function merkleRootHex(leaves: SpatialBlockLeaf[]): string {
  return computeMerkleRoot(leaves).toString('hex');
}

/** Authenticate the package root (server-side MAC — secret never in image) */
export function computeRootMac(params: {
  dnaRecordId: string;
  ownerUserId: string;
  width: number;
  height: number;
  orientationPolicy: string;
  globalDnaRef: string;
  keyId: string;
  algorithmVersion: string;
  primaryScale: number;
  scales: number[];
  merkleRootHex: string;
  masterSecret?: string;
}): string {
  const rootKey = deriveSpatialRootMacKey({
    dnaRecordId: params.dnaRecordId,
    keyId: params.keyId,
    masterSecret: params.masterSecret,
    algorithmVersion: params.algorithmVersion,
  });
  const encoding = encodingForSpatialAuthVersion(params.algorithmVersion);

  let payload: Buffer;
  if (encoding === 'pipe-v1') {
    // Legacy exact: scales joined in the order provided (enrollment uses ascending)
    payload = buildCryptoPayload(encoding, 'ROOT-MAC-v1', [
      { type: 'str', value: params.keyId },
      { type: 'str', value: params.algorithmVersion },
      { type: 'str', value: params.dnaRecordId },
      { type: 'str', value: params.ownerUserId },
      { type: 'str', value: String(params.width) },
      { type: 'str', value: String(params.height) },
      { type: 'str', value: params.orientationPolicy },
      { type: 'str', value: params.globalDnaRef },
      { type: 'str', value: String(params.primaryScale) },
      { type: 'str', value: params.scales.join(',') },
      { type: 'str', value: params.merkleRootHex },
    ]);
  } else {
    // lpbin-v1.1 — fixed-width ints; scales as count + u16 list (ascending)
    const scalesSorted = [...params.scales].sort((a, b) => a - b);
    const scaleFields: import('./crypto-encoding').CryptoField[] = [
      { type: 'str', value: params.keyId },
      { type: 'str', value: params.algorithmVersion },
      { type: 'str', value: params.dnaRecordId },
      { type: 'str', value: params.ownerUserId },
      { type: 'u32', value: params.width },
      { type: 'u32', value: params.height },
      { type: 'str', value: params.orientationPolicy },
      { type: 'str', value: params.globalDnaRef },
      { type: 'u16', value: params.primaryScale },
      { type: 'u16', value: scalesSorted.length },
      ...scalesSorted.map((s) => ({ type: 'u16' as const, value: s })),
      { type: 'str', value: params.merkleRootHex },
    ];
    payload = buildCryptoPayload(encoding, 'ROOT-MAC-v1', scaleFields);
  }

  return crypto.createHmac('sha256', rootKey).update(payload).digest('hex');
}

export function verifyRootMac(
  params: Parameters<typeof computeRootMac>[0] & { rootMac: string },
): boolean {
  const expected = computeRootMac(params);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(params.rootMac, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}
