/**
 * Spatial Auth Phase 1 — position-bound block HMAC tags
 * Phase 3F: MAC message encoding versioned (pipe-v1 vs lpbin-v1.1)
 */

import crypto from 'crypto';
import { spatialAuthConfig } from '../../config/spatial-auth';
import { SPATIAL_TAG_BYTES } from './constants';
import { extractBlockRgb, buildBlockGrid } from './block-grid';
import {
  buildCryptoPayload,
  encodingForSpatialAuthVersion,
} from './crypto-encoding';
import type { SpatialBlockLeaf } from './types';

/**
 * Canonical MAC message for a block.
 * Binding: algo, image id, global DNA ref, scale, id, geometry, content hash.
 */
export function buildBlockMacMessage(params: {
  algorithmVersion: string;
  dnaRecordId: string;
  globalDnaRef: string;
  scale: number;
  blockId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  contentSha256Hex: string;
}): Buffer {
  const encoding = encodingForSpatialAuthVersion(params.algorithmVersion);
  return buildCryptoPayload(encoding, 'A', [
    { type: 'str', value: params.algorithmVersion },
    { type: 'str', value: params.dnaRecordId },
    { type: 'str', value: params.globalDnaRef },
    { type: 'u16', value: params.scale },
    { type: 'u32', value: params.blockId },
    { type: 'u16', value: params.x },
    { type: 'u16', value: params.y },
    { type: 'u16', value: params.width },
    { type: 'u16', value: params.height },
    { type: 'str', value: params.contentSha256Hex },
  ]);
}

export function computeBlockContentHash(blockRgb: Buffer): string {
  return crypto.createHash('sha256').update(blockRgb).digest('hex');
}

export function computeBlockAuthTag(params: {
  imageKey: Buffer;
  algorithmVersion: string;
  dnaRecordId: string;
  globalDnaRef: string;
  scale: number;
  blockId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  blockRgb: Buffer;
  tagBytes?: number;
}): Buffer {
  const contentSha256Hex = computeBlockContentHash(params.blockRgb);
  const message = buildBlockMacMessage({
    algorithmVersion: params.algorithmVersion,
    dnaRecordId: params.dnaRecordId,
    globalDnaRef: params.globalDnaRef,
    scale: params.scale,
    blockId: params.blockId,
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    contentSha256Hex,
  });
  const full = crypto.createHmac('sha256', params.imageKey).update(message).digest();
  const n = params.tagBytes ?? spatialAuthConfig.tagBytes ?? SPATIAL_TAG_BYTES;
  return full.subarray(0, n);
}

export function authenticateBlocksForScale(params: {
  rgb: Buffer;
  width: number;
  height: number;
  scale: number;
  imageKey: Buffer;
  algorithmVersion: string;
  dnaRecordId: string;
  globalDnaRef: string;
}): SpatialBlockLeaf[] {
  const grid = buildBlockGrid(params.width, params.height, params.scale);
  return grid.map((geom) => {
    const blockRgb = extractBlockRgb(params.rgb, params.width, params.height, geom);
    const tag = computeBlockAuthTag({
      imageKey: params.imageKey,
      algorithmVersion: params.algorithmVersion,
      dnaRecordId: params.dnaRecordId,
      globalDnaRef: params.globalDnaRef,
      scale: geom.scale,
      blockId: geom.blockId,
      x: geom.x,
      y: geom.y,
      width: geom.width,
      height: geom.height,
      blockRgb,
    });
    return { ...geom, tag };
  });
}

export function authenticateAllScales(params: {
  rgb: Buffer;
  width: number;
  height: number;
  scales: number[];
  imageKey: Buffer;
  algorithmVersion: string;
  dnaRecordId: string;
  globalDnaRef: string;
}): SpatialBlockLeaf[] {
  const leaves: SpatialBlockLeaf[] = [];
  for (const scale of [...params.scales].sort((a, b) => a - b)) {
    leaves.push(
      ...authenticateBlocksForScale({
        rgb: params.rgb,
        width: params.width,
        height: params.height,
        scale,
        imageKey: params.imageKey,
        algorithmVersion: params.algorithmVersion,
        dnaRecordId: params.dnaRecordId,
        globalDnaRef: params.globalDnaRef,
      }),
    );
  }
  return leaves;
}
