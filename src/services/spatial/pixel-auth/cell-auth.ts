/**
 * Phase 3A — position/image/content-bound cell HMAC tags
 * Phase 3F: MAC message encoding versioned (pipe-v1 vs lpbin-v1.1)
 */

import crypto from 'crypto';
import { spatialPixelAuthConfig } from '../../../config/spatial-pixel-auth';
import { buildPixelCellGrid, extractCellRgb } from './cell-grid';
import {
  buildCryptoPayload,
  encodingForSpatialPixelVersion,
} from '../crypto-encoding';
import type { PixelCellLeaf } from './types';

export function buildPixelCellMacMessage(params: {
  algorithmVersion: string;
  dnaRecordId: string;
  globalDnaRef: string;
  cellSize: number;
  cellId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  contentSha256Hex: string;
}): Buffer {
  const encoding = encodingForSpatialPixelVersion(params.algorithmVersion);
  return buildCryptoPayload(encoding, 'P3', [
    { type: 'str', value: params.algorithmVersion },
    { type: 'str', value: params.dnaRecordId },
    { type: 'str', value: params.globalDnaRef },
    { type: 'u16', value: params.cellSize },
    { type: 'u32', value: params.cellId },
    { type: 'u16', value: params.x },
    { type: 'u16', value: params.y },
    { type: 'u16', value: params.width },
    { type: 'u16', value: params.height },
    { type: 'str', value: params.contentSha256Hex },
  ]);
}

export function computeCellContentHash(cellRgb: Buffer): string {
  return crypto.createHash('sha256').update(cellRgb).digest('hex');
}

export function computePixelCellAuthTag(params: {
  pixelKey: Buffer;
  algorithmVersion: string;
  dnaRecordId: string;
  globalDnaRef: string;
  cellSize: number;
  cellId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cellRgb: Buffer;
  tagBytes?: number;
}): Buffer {
  const contentSha256Hex = computeCellContentHash(params.cellRgb);
  const message = buildPixelCellMacMessage({
    algorithmVersion: params.algorithmVersion,
    dnaRecordId: params.dnaRecordId,
    globalDnaRef: params.globalDnaRef,
    cellSize: params.cellSize,
    cellId: params.cellId,
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    contentSha256Hex,
  });
  const full = crypto.createHmac('sha256', params.pixelKey).update(message).digest();
  const n = params.tagBytes ?? spatialPixelAuthConfig.tagBytes;
  return full.subarray(0, n);
}

export function authenticateAllPixelCells(params: {
  rgb: Buffer;
  width: number;
  height: number;
  cellSize: number;
  pixelKey: Buffer;
  algorithmVersion: string;
  dnaRecordId: string;
  globalDnaRef: string;
  tagBytes?: number;
}): PixelCellLeaf[] {
  const grid = buildPixelCellGrid(params.width, params.height, params.cellSize);
  return grid.map((geom) => {
    const cellRgb = extractCellRgb(params.rgb, params.width, params.height, geom);
    const tag = computePixelCellAuthTag({
      pixelKey: params.pixelKey,
      algorithmVersion: params.algorithmVersion,
      dnaRecordId: params.dnaRecordId,
      globalDnaRef: params.globalDnaRef,
      cellSize: params.cellSize,
      cellId: geom.cellId,
      x: geom.x,
      y: geom.y,
      width: geom.width,
      height: geom.height,
      cellRgb,
      tagBytes: params.tagBytes,
    });
    return { ...geom, tag };
  });
}
