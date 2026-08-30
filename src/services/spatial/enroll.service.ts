/**
 * Spatial Auth Phase 1 — persistence + enrollment orchestration
 * Phase 3A: optional HKCA pixel layer when SPATIAL_PIXEL_AUTH_ENABLED
 */

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { isSpatialAuthEnabled, spatialAuthConfig } from '../../config/spatial-auth';
import {
  isSpatialPixelAuthEnabled,
  spatialPixelAuthConfig,
  SPATIAL_PIXEL_ALGORITHM_VERSION,
} from '../../config/spatial-pixel-auth';
import { isSpatialPixel1AuthEnabled } from '../../config/spatial-hierarchy';
import { decodeImageForSpatialAuth } from './image-decode';
import { buildSpatialAuthPackageFromRgb, resolveGlobalDnaRef } from './package-builder';
import { buildPixelAuthPackageFromRgb } from './pixel-auth/package-builder';
import { buildPixel1AuthPackageFromRgb } from './hierarchy/pixel1-enroll';
import type { SpatialAuthPackageData, SpatialEnrollmentResult } from './types';

export async function loadSpatialAuthPackage(
  dnaRecordId: string,
): Promise<SpatialAuthPackageData | null> {
  const row = await prisma.spatialAuthPackage.findUnique({
    where: { dnaRecordId },
  });
  if (!row) return null;
  return {
    dnaRecordId: row.dnaRecordId,
    ownerUserId: row.ownerUserId,
    width: row.width,
    height: row.height,
    orientationPolicy: row.orientationPolicy,
    globalDnaRef: row.globalDnaRef,
    keyId: row.keyId,
    algorithmVersion: row.algorithmVersion,
    primaryScale: row.primaryScale,
    scales: row.scales,
    merkleRoot: row.merkleRoot,
    rootMac: row.rootMac,
    blockBlob: Buffer.from(row.blockBlob),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pixelAlgoVersion: row.pixelAlgoVersion,
    pixelScheme: row.pixelScheme,
    pixelKeyId: row.pixelKeyId,
    pixelCellSize: row.pixelCellSize,
    pixelTagBytes: row.pixelTagBytes,
    pixelAuthBlob: row.pixelAuthBlob ? Buffer.from(row.pixelAuthBlob) : null,
    pixelAuthRoot: row.pixelAuthRoot,
    pixelRootMac: row.pixelRootMac,
    pixel1AlgoVersion: row.pixel1AlgoVersion,
    pixel1KeyId: row.pixel1KeyId,
    pixel1TagBytes: row.pixel1TagBytes,
    pixel1AuthBlob: row.pixel1AuthBlob ? Buffer.from(row.pixel1AuthBlob) : null,
    pixel1AuthRoot: row.pixel1AuthRoot,
    pixel1RootMac: row.pixel1RootMac,
  };
}

export async function persistSpatialAuthPackage(
  packageData: SpatialAuthPackageData,
): Promise<void> {
  const pixelFields = {
    pixelAlgoVersion: packageData.pixelAlgoVersion ?? null,
    pixelScheme: packageData.pixelScheme ?? null,
    pixelKeyId: packageData.pixelKeyId ?? null,
    pixelCellSize: packageData.pixelCellSize ?? null,
    pixelTagBytes: packageData.pixelTagBytes ?? null,
    pixelAuthBlob: packageData.pixelAuthBlob ?? null,
    pixelAuthRoot: packageData.pixelAuthRoot ?? null,
    pixelRootMac: packageData.pixelRootMac ?? null,
    pixel1AlgoVersion: packageData.pixel1AlgoVersion ?? null,
    pixel1KeyId: packageData.pixel1KeyId ?? null,
    pixel1TagBytes: packageData.pixel1TagBytes ?? null,
    pixel1AuthBlob: packageData.pixel1AuthBlob ?? null,
    pixel1AuthRoot: packageData.pixel1AuthRoot ?? null,
    pixel1RootMac: packageData.pixel1RootMac ?? null,
  };

  await prisma.spatialAuthPackage.upsert({
    where: { dnaRecordId: packageData.dnaRecordId },
    create: {
      dnaRecordId: packageData.dnaRecordId,
      ownerUserId: packageData.ownerUserId,
      width: packageData.width,
      height: packageData.height,
      orientationPolicy: packageData.orientationPolicy,
      globalDnaRef: packageData.globalDnaRef,
      keyId: packageData.keyId,
      algorithmVersion: packageData.algorithmVersion,
      primaryScale: packageData.primaryScale,
      scales: packageData.scales,
      merkleRoot: packageData.merkleRoot,
      rootMac: packageData.rootMac,
      blockBlob: packageData.blockBlob,
      ...pixelFields,
    },
    update: {
      ownerUserId: packageData.ownerUserId,
      width: packageData.width,
      height: packageData.height,
      orientationPolicy: packageData.orientationPolicy,
      globalDnaRef: packageData.globalDnaRef,
      keyId: packageData.keyId,
      algorithmVersion: packageData.algorithmVersion,
      primaryScale: packageData.primaryScale,
      scales: packageData.scales,
      merkleRoot: packageData.merkleRoot,
      rootMac: packageData.rootMac,
      blockBlob: packageData.blockBlob,
      ...pixelFields,
    },
  });
}

/**
 * Enroll Mode A spatial auth for an image buffer.
 * Phase 3A HKCA attached when SPATIAL_PIXEL_AUTH_ENABLED (no GLPM / no pixel writes).
 */
export async function enrollSpatialAuth(params: {
  imageBuffer: Buffer;
  dnaRecordId: string;
  ownerUserId: string;
  contentSealHmac?: string | null;
  sha256Hash?: string | null;
  /** Skip the dense per-pixel (4E) pass — expensive (~40s/17MB per image) and
   * not needed where cheaper HKCA (3A) + patch-level local-DNA already give
   * tamper localization (e.g. document pages, where it multiplies by page count). */
  skipPixel1?: boolean;
}): Promise<SpatialEnrollmentResult> {
  if (!isSpatialAuthEnabled()) {
    throw new Error('Spatial auth is disabled (SPATIAL_AUTH_ENABLED=false)');
  }

  const decoded = await decodeImageForSpatialAuth(params.imageBuffer);
  const globalDnaRef = resolveGlobalDnaRef({
    contentSealHmac: params.contentSealHmac,
    sha256Hash: params.sha256Hash,
    dnaRecordId: params.dnaRecordId,
  });

  const { packageData, enrollment } = buildSpatialAuthPackageFromRgb({
    rgb: decoded.rgb,
    width: decoded.width,
    height: decoded.height,
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    globalDnaRef,
  });

  let pixelEnrollment = null;
  if (isSpatialPixelAuthEnabled()) {
    const { pixel, enrollment: pe } = buildPixelAuthPackageFromRgb({
      rgb: decoded.rgb,
      width: decoded.width,
      height: decoded.height,
      dnaRecordId: params.dnaRecordId,
      ownerUserId: params.ownerUserId,
      globalDnaRef,
    });
    packageData.pixelAlgoVersion = pixel.algorithmVersion;
    packageData.pixelScheme = pixel.scheme;
    packageData.pixelKeyId = pixel.keyId;
    packageData.pixelCellSize = pixel.cellSize;
    packageData.pixelTagBytes = pixel.tagBytes;
    packageData.pixelAuthBlob = pixel.pixelAuthBlob;
    packageData.pixelAuthRoot = pixel.pixelAuthRoot;
    packageData.pixelRootMac = pixel.pixelRootMac;
    pixelEnrollment = pe;
    logger.info('Spatial pixel HKCA (3A) enrolled', {
      dnaRecordId: params.dnaRecordId,
      cellCount: pe.cellCount,
      tagBytes: pe.tagBytes,
      blobBytes: pe.blobBytes,
      enrollmentMs: pe.enrollmentMs,
    });
  }

  if (isSpatialPixel1AuthEnabled() && !params.skipPixel1) {
    const p1 = buildPixel1AuthPackageFromRgb({
      rgb: decoded.rgb,
      width: decoded.width,
      height: decoded.height,
      dnaRecordId: params.dnaRecordId,
      ownerUserId: params.ownerUserId,
      globalDnaRef,
      keyId: packageData.keyId,
      masterSecret: spatialAuthConfig.masterSecret,
    });
    packageData.pixel1AlgoVersion = p1.algorithmVersion;
    packageData.pixel1KeyId = p1.keyId;
    packageData.pixel1TagBytes = p1.tagBytes;
    packageData.pixel1AuthBlob = p1.pixel1AuthBlob;
    packageData.pixel1AuthRoot = p1.pixel1AuthRoot;
    packageData.pixel1RootMac = p1.pixel1RootMac;
    logger.info('Spatial pixel1 (4E) enrolled', {
      dnaRecordId: params.dnaRecordId,
      pixelCount: p1.pixelCount,
      blobBytes: p1.blobBytes,
      enrollmentMs: p1.enrollmentMs,
    });
  }

  await persistSpatialAuthPackage(packageData);

  logger.info('Spatial auth package enrolled', {
    dnaRecordId: params.dnaRecordId,
    width: enrollment.width,
    height: enrollment.height,
    blockCount: enrollment.blockCount,
    packageBytes: enrollment.packageBytes,
    enrollmentMs: enrollment.enrollmentMs,
    primaryScale: enrollment.primaryScale,
    scales: enrollment.scales,
    pixelEnabled: !!pixelEnrollment,
  });

  return { ...enrollment, pixel: pixelEnrollment };
}

/**
 * Non-fatal hook for DnaOrchestrator — skips when flag off or missing owner.
 */
export async function tryEnrollSpatialAuthAfterDna(params: {
  imageBuffer: Buffer;
  dnaRecordId: string;
  ownerUserId?: string | null;
  skipPixel1?: boolean;
}): Promise<SpatialEnrollmentResult | null> {
  if (!isSpatialAuthEnabled()) return null;
  if (!params.ownerUserId) {
    logger.warn('Spatial auth skipped — no ownerUserId', { dnaRecordId: params.dnaRecordId });
    return null;
  }

  try {
    const dna = await prisma.dnaRecord.findUnique({
      where: { id: params.dnaRecordId },
      select: {
        sha256Hash: true,
        stegoLayer: { select: { payloadHmac: true } },
        universalFingerprints: true,
      },
    });

    let contentSeal: string | null = null;
    const fp = dna?.universalFingerprints as
      | { identityDeterministic?: { contentSealHmac?: string } }
      | null;
    if (fp?.identityDeterministic?.contentSealHmac) {
      contentSeal = fp.identityDeterministic.contentSealHmac;
    }

    return await enrollSpatialAuth({
      imageBuffer: params.imageBuffer,
      dnaRecordId: params.dnaRecordId,
      ownerUserId: params.ownerUserId,
      contentSealHmac: contentSeal,
      sha256Hash: dna?.sha256Hash ?? null,
      skipPixel1: params.skipPixel1,
    });
  } catch (err) {
    logger.warn('Spatial auth enrollment failed (non-fatal)', {
      dnaRecordId: params.dnaRecordId,
      error: String(err),
    });
    return null;
  }
}

/** Expose config snapshot for API diagnostics */
export function spatialAuthStatus(): {
  enabled: boolean;
  algorithmVersion: string;
  keyId: string;
  primaryScale: number;
  orientationPolicy: string;
  pixelAuthEnabled: boolean;
  pixelAlgoVersion: string;
  pixelTagBytes: number;
  pixelCellSize: number;
  glpmEnabled: false;
} {
  return {
    enabled: isSpatialAuthEnabled(),
    algorithmVersion: spatialAuthConfig.algorithmVersion,
    keyId: spatialAuthConfig.keyId,
    primaryScale: spatialAuthConfig.primaryScale,
    orientationPolicy: spatialAuthConfig.orientationPolicy,
    pixelAuthEnabled: isSpatialPixelAuthEnabled(),
    pixelAlgoVersion: SPATIAL_PIXEL_ALGORITHM_VERSION,
    pixelTagBytes: spatialPixelAuthConfig.tagBytes,
    pixelCellSize: spatialPixelAuthConfig.cellSize,
    glpmEnabled: false,
  };
}
