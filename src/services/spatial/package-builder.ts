/**
 * Spatial Auth Phase 1 — build an in-memory auth package from RGB pixels
 */

import {
  SPATIAL_AUTH_ALGORITHM_VERSION,
  SPATIAL_ORIENTATION_POLICY,
  spatialAuthConfig,
  spatialAuthEnrollmentScales,
} from '../../config/spatial-auth';
import { authenticateAllScales } from './block-auth';
import { encodeBlockBlob } from './block-blob';
import { deriveSpatialBlockKey } from './key-derivation';
import { computeRootMac, merkleRootHex } from './merkle';
import type { SpatialAuthPackageData, SpatialEnrollmentResult } from './types';

export function resolveGlobalDnaRef(params: {
  contentSealHmac?: string | null;
  sha256Hash?: string | null;
  dnaRecordId: string;
}): string {
  if (params.contentSealHmac && params.contentSealHmac.length >= 16) {
    return params.contentSealHmac;
  }
  if (params.sha256Hash && params.sha256Hash.length >= 16) {
    return `sha256:${params.sha256Hash}`;
  }
  return `dna:${params.dnaRecordId}`;
}

export function buildSpatialAuthPackageFromRgb(params: {
  rgb: Buffer;
  width: number;
  height: number;
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  scales?: number[];
  primaryScale?: number;
  keyId?: string;
  algorithmVersion?: string;
  masterSecret?: string;
}): { packageData: SpatialAuthPackageData; enrollment: SpatialEnrollmentResult } {
  const started = Date.now();
  const algorithmVersion = params.algorithmVersion ?? SPATIAL_AUTH_ALGORITHM_VERSION;
  const keyId = params.keyId ?? spatialAuthConfig.keyId;
  const primaryScale = params.primaryScale ?? spatialAuthConfig.primaryScale;
  const scales = params.scales ?? spatialAuthEnrollmentScales();
  if (!scales.includes(primaryScale)) {
    scales.push(primaryScale);
    scales.sort((a, b) => a - b);
  }

  const imageKey = deriveSpatialBlockKey({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    globalDnaRef: params.globalDnaRef,
    keyId,
    masterSecret: params.masterSecret,
    algorithmVersion,
  });

  const leaves = authenticateAllScales({
    rgb: params.rgb,
    width: params.width,
    height: params.height,
    scales,
    imageKey,
    algorithmVersion,
    dnaRecordId: params.dnaRecordId,
    globalDnaRef: params.globalDnaRef,
  });

  const root = merkleRootHex(leaves);
  const blockBlob = encodeBlockBlob({ algorithmVersion, primaryScale, leaves });
  const rootMac = computeRootMac({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    width: params.width,
    height: params.height,
    orientationPolicy: SPATIAL_ORIENTATION_POLICY,
    globalDnaRef: params.globalDnaRef,
    keyId,
    algorithmVersion,
    primaryScale,
    scales,
    merkleRootHex: root,
    masterSecret: params.masterSecret,
  });

  const packageData: SpatialAuthPackageData = {
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    width: params.width,
    height: params.height,
    orientationPolicy: SPATIAL_ORIENTATION_POLICY,
    globalDnaRef: params.globalDnaRef,
    keyId,
    algorithmVersion,
    primaryScale,
    scales,
    merkleRoot: root,
    rootMac,
    blockBlob,
  };

  const enrollment: SpatialEnrollmentResult = {
    dnaRecordId: params.dnaRecordId,
    width: params.width,
    height: params.height,
    primaryScale,
    scales,
    blockCount: leaves.length,
    merkleRoot: root,
    packageBytes: blockBlob.length,
    enrollmentMs: Date.now() - started,
    algorithmVersion,
    keyId,
  };

  return { packageData, enrollment };
}
