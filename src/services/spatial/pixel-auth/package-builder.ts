/**
 * Phase 3A — build server-side HKCA package from RGB (no pixel embedding)
 */

import {
  SPATIAL_PIXEL_ALGORITHM_VERSION,
  SPATIAL_PIXEL_SCHEME,
  spatialPixelAuthConfig,
} from '../../../config/spatial-pixel-auth';
import { SPATIAL_ORIENTATION_POLICY } from '../../../config/spatial-auth';
import { authenticateAllPixelCells } from './cell-auth';
import { deriveSpatialPixelKey } from './key-derivation';
import { encodePixelAuthBlob } from './pixel-blob';
import { computePixelRootMac, pixelMerkleRootHex } from './pixel-merkle';
import type { PixelAuthPackageData, PixelEnrollmentResult } from './types';

export function buildPixelAuthPackageFromRgb(params: {
  rgb: Buffer;
  width: number;
  height: number;
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId?: string;
  tagBytes?: 8 | 16;
  masterSecret?: string;
  /** Defaults to current hardened version; pass legacy for compatibility tests */
  algorithmVersion?: string;
}): { pixel: PixelAuthPackageData; enrollment: PixelEnrollmentResult } {
  const started = Date.now();
  const algorithmVersion = params.algorithmVersion ?? SPATIAL_PIXEL_ALGORITHM_VERSION;
  const scheme = SPATIAL_PIXEL_SCHEME;
  const cellSize = spatialPixelAuthConfig.cellSize;
  const tagBytes = params.tagBytes ?? spatialPixelAuthConfig.tagBytes;
  const keyId = params.keyId ?? spatialPixelAuthConfig.keyId;

  const pixelKey = deriveSpatialPixelKey({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    globalDnaRef: params.globalDnaRef,
    keyId,
    masterSecret: params.masterSecret,
    algorithmVersion,
  });

  const leaves = authenticateAllPixelCells({
    rgb: params.rgb,
    width: params.width,
    height: params.height,
    cellSize,
    pixelKey,
    algorithmVersion,
    dnaRecordId: params.dnaRecordId,
    globalDnaRef: params.globalDnaRef,
    tagBytes,
  });

  const pixelAuthRoot = pixelMerkleRootHex(leaves);
  const pixelAuthBlob = encodePixelAuthBlob({
    algorithmVersion,
    scheme,
    cellSize,
    tagBytes,
    leaves,
  });
  const pixelRootMac = computePixelRootMac({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    width: params.width,
    height: params.height,
    orientationPolicy: SPATIAL_ORIENTATION_POLICY,
    globalDnaRef: params.globalDnaRef,
    keyId,
    algorithmVersion,
    scheme,
    cellSize,
    tagBytes,
    pixelAuthRootHex: pixelAuthRoot,
    masterSecret: params.masterSecret,
  });

  return {
    pixel: {
      algorithmVersion,
      scheme,
      keyId,
      cellSize,
      tagBytes,
      pixelAuthBlob,
      pixelAuthRoot,
      pixelRootMac,
    },
    enrollment: {
      cellCount: leaves.length,
      cellSize,
      tagBytes,
      blobBytes: pixelAuthBlob.length,
      pixelAuthRoot,
      enrollmentMs: Date.now() - started,
      algorithmVersion,
      scheme,
    },
  };
}
