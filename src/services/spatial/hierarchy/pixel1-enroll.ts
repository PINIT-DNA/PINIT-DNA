/**
 * Phase 4E — enroll dense 1×1 HMAC tags for all pixels (compact blob, not per-row DB)
 */

import { spatialHierarchyConfig } from '../../../config/spatial-hierarchy';
import { SPATIAL_ORIENTATION_POLICY } from '../../../config/spatial-auth';
import { unitIdAt } from './unit-grid';
import { encodePixel1AuthBlob } from './pixel1-blob';
import { computePixel1AuthRootHex, computePixel1RootMac } from './pixel1-merkle';
import { computePixel1AuthTag, deriveSpatialPixel1Key } from './pixel1-auth';

export interface Pixel1EnrollmentPackage {
  algorithmVersion: string;
  keyId: string;
  tagBytes: number;
  pixel1AuthBlob: Buffer;
  pixel1AuthRoot: string;
  pixel1RootMac: string;
  pixelCount: number;
  blobBytes: number;
  enrollmentMs: number;
}

export function buildPixel1AuthPackageFromRgb(params: {
  rgb: Buffer;
  width: number;
  height: number;
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId?: string;
  tagBytes?: number;
  masterSecret: string;
}): Pixel1EnrollmentPackage {
  const started = Date.now();
  const algorithmVersion = spatialHierarchyConfig.pixel1AlgorithmVersion;
  const tagBytes = params.tagBytes ?? spatialHierarchyConfig.pixel1TagBytes;
  const keyId = params.keyId ?? 'spatial-key-v1';
  const { width, height, rgb } = params;
  const pixelCount = width * height;
  if (rgb.length !== pixelCount * 3) {
    throw new Error(`RGB length ${rgb.length} != ${pixelCount * 3}`);
  }

  const key = deriveSpatialPixel1Key({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    globalDnaRef: params.globalDnaRef,
    keyId,
    masterSecret: params.masterSecret,
  });

  const tags = Buffer.alloc(pixelCount * tagBytes);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const parentCellId = unitIdAt(2, width, Math.floor(x / 2), Math.floor(y / 2));
      const tag = computePixel1AuthTag({
        pixel1Key: key,
        algorithmVersion,
        dnaRecordId: params.dnaRecordId,
        globalDnaRef: params.globalDnaRef,
        parentCellId,
        x,
        y,
        width: 1,
        height: 1,
        r: rgb[i]!,
        g: rgb[i + 1]!,
        b: rgb[i + 2]!,
        tagBytes,
      });
      tag.copy(tags, (y * width + x) * tagBytes);
    }
  }

  const pixel1AuthBlob = encodePixel1AuthBlob({
    algorithmVersion,
    width,
    height,
    tagBytes,
    tags,
  });
  const pixel1AuthRoot = computePixel1AuthRootHex(tags);
  const pixel1RootMac = computePixel1RootMac({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    width,
    height,
    orientationPolicy: SPATIAL_ORIENTATION_POLICY,
    globalDnaRef: params.globalDnaRef,
    keyId,
    algorithmVersion,
    tagBytes,
    pixel1AuthRootHex: pixel1AuthRoot,
    masterSecret: params.masterSecret,
  });

  return {
    algorithmVersion,
    keyId,
    tagBytes,
    pixel1AuthBlob,
    pixel1AuthRoot,
    pixel1RootMac,
    pixelCount,
    blobBytes: pixel1AuthBlob.length,
    enrollmentMs: Date.now() - started,
  };
}
