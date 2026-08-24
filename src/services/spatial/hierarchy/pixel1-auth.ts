/**
 * Phase 4D/4E — 1×1 pixel HMAC (lazy under failed 2×2)
 * Phase 4E: verify candidate HMAC against ENROLLED dense tag blob (not live ref HMAC).
 */

import crypto from 'crypto';
import { spatialHierarchyConfig } from '../../../config/spatial-hierarchy';
import { buildCryptoPayload, buildHkdfInfo } from '../crypto-encoding';
import { subdivideUnit } from './unit-grid';
import { containsRect } from './ancestry';
import type { Quad2CellResult } from './quad2-auth';
import {
  decodePixel1AuthBlob,
  lookupPixel1EnrolledTag,
  type Pixel1BlobDecoded,
} from './pixel1-blob';
import { verifyPixel1BlobIntegrity } from './pixel1-merkle';

export const PIXEL1_HKDF_INFO = 'pinit-spatial-pixel1-hmac-v1';
export const PIXEL1_MAC_DOMAIN = 'P1';

const KEY_BYTES = 32;

export type Pixel1Status = 'AUTHENTIC' | 'TAMPERED' | 'UNKNOWN';

export interface Pixel1Result {
  x: number;
  y: number;
  parentCellId: number;
  r: number;
  g: number;
  b: number;
  status: Pixel1Status;
}

export interface Pixel1LocalizationResult {
  derivedEvidenceOnly: true;
  trusted: boolean;
  localizationUnit: '1x1_pixel';
  localizationClaim: '1x1_pixel' | 'none';
  productionClaim: '8x8_cell' | '1x1_pixel';
  algorithmVersion: string;
  cellSize: 1;
  tagBytes: number;
  /** Phase 4E — verification against enrolled tags */
  enrolledVerification: true;
  pixels: Pixel1Result[];
  tamperedPixels: Pixel1Result[];
  stats: {
    parentsInspected: number;
    pixelsInspected: number;
    pixelsPassed: number;
    pixelsFailed: number;
    comparisonMs: number;
    authMs: number;
  };
  unavailableReason?: string;
  verificationMs: number;
}

function readPixelRgb(rgb: Buffer, imageWidth: number, x: number, y: number): { r: number; g: number; b: number } {
  const i = (y * imageWidth + x) * 3;
  return { r: rgb[i]!, g: rgb[i + 1]!, b: rgb[i + 2]! };
}

export function deriveSpatialPixel1Key(params: {
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId: string;
  masterSecret: string;
}): Buffer {
  const info = buildHkdfInfo('lpbin-v1.1', PIXEL1_HKDF_INFO, [
    params.ownerUserId,
    params.globalDnaRef,
    params.keyId,
  ]);
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(params.masterSecret, 'utf8'),
      Buffer.from(params.dnaRecordId, 'utf8'),
      info,
      KEY_BYTES,
    ),
  );
}

export function computePixel1AuthTag(params: {
  pixel1Key: Buffer;
  algorithmVersion: string;
  dnaRecordId: string;
  globalDnaRef: string;
  parentCellId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  r: number;
  g: number;
  b: number;
  tagBytes?: number;
}): Buffer {
  const payload = buildCryptoPayload('lpbin-v1.1', PIXEL1_MAC_DOMAIN, [
    { type: 'str', value: params.algorithmVersion },
    { type: 'str', value: params.dnaRecordId },
    { type: 'str', value: params.globalDnaRef },
    { type: 'u32', value: params.parentCellId },
    { type: 'u16', value: params.x },
    { type: 'u16', value: params.y },
    { type: 'u16', value: params.width },
    { type: 'u16', value: params.height },
    { type: 'u16', value: params.r },
    { type: 'u16', value: params.g },
    { type: 'u16', value: params.b },
  ]);
  const full = crypto.createHmac('sha256', params.pixel1Key).update(payload).digest();
  const n = params.tagBytes ?? spatialHierarchyConfig.pixel1TagBytes;
  return full.subarray(0, n);
}

function tagsEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function pixel1Unavailable(reason: string): Pixel1LocalizationResult {
  return {
    derivedEvidenceOnly: true,
    trusted: false,
    localizationUnit: '1x1_pixel',
    localizationClaim: 'none',
    productionClaim: '8x8_cell',
    algorithmVersion: spatialHierarchyConfig.pixel1AlgorithmVersion,
    cellSize: 1,
    tagBytes: spatialHierarchyConfig.pixel1TagBytes,
    enrolledVerification: true,
    pixels: [],
    tamperedPixels: [],
    stats: {
      parentsInspected: 0,
      pixelsInspected: 0,
      pixelsPassed: 0,
      pixelsFailed: 0,
      comparisonMs: 0,
      authMs: 0,
    },
    unavailableReason: reason,
    verificationMs: 0,
  };
}

/**
 * Lazy 1×1 auth: HMAC(candidate) vs ENROLLED tag from package blob.
 */
export function verifyPixel1UnderFailed2x2(params: {
  imageWidth: number;
  imageHeight: number;
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId: string;
  masterSecret: string;
  failed2x2: Quad2CellResult[];
  candidateRgb: Buffer;
  orientationPolicy?: string;
  /** Enrolled dense tag package fields */
  pixel1AuthBlob: Buffer;
  pixel1AuthRoot: string;
  pixel1RootMac: string;
}): Pixel1LocalizationResult {
  const started = Date.now();
  const algo = spatialHierarchyConfig.pixel1AlgorithmVersion;

  if (
    params.orientationPolicy &&
    params.orientationPolicy !== spatialHierarchyConfig.orientationPolicy
  ) {
    return { ...pixel1Unavailable('ORIENTATION_POLICY_MISMATCH'), verificationMs: Date.now() - started };
  }

  const expectedLen = params.imageWidth * params.imageHeight * 3;
  if (params.candidateRgb.length !== expectedLen) {
    return {
      ...pixel1Unavailable('CANDIDATE_DIMENSION_MISMATCH'),
      verificationMs: Date.now() - started,
    };
  }

  let decoded: Pixel1BlobDecoded;
  try {
    decoded = decodePixel1AuthBlob(params.pixel1AuthBlob);
  } catch (err) {
    return {
      ...pixel1Unavailable(`INVALID_PIXEL1_BLOB:${String(err)}`),
      verificationMs: Date.now() - started,
    };
  }

  if (decoded.width !== params.imageWidth || decoded.height !== params.imageHeight) {
    return {
      ...pixel1Unavailable('PIXEL1_BLOB_DIMENSION_MISMATCH'),
      verificationMs: Date.now() - started,
    };
  }
  if (decoded.algorithmVersion !== algo) {
    return {
      ...pixel1Unavailable('UNSUPPORTED_PIXEL1_VERSION'),
      verificationMs: Date.now() - started,
    };
  }

  const integ = verifyPixel1BlobIntegrity({
    decoded,
    pixel1AuthRootHex: params.pixel1AuthRoot,
    pixel1RootMac: params.pixel1RootMac,
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    orientationPolicy: params.orientationPolicy ?? spatialHierarchyConfig.orientationPolicy,
    globalDnaRef: params.globalDnaRef,
    keyId: params.keyId,
    masterSecret: params.masterSecret,
  });
  if (!integ.ok) {
    return {
      ...pixel1Unavailable(integ.reason),
      verificationMs: Date.now() - started,
    };
  }

  if (!params.failed2x2.length) {
    return {
      derivedEvidenceOnly: true,
      trusted: true,
      localizationUnit: '1x1_pixel',
      localizationClaim: '1x1_pixel',
      productionClaim: '1x1_pixel',
      algorithmVersion: algo,
      cellSize: 1,
      tagBytes: decoded.tagBytes,
      enrolledVerification: true,
      pixels: [],
      tamperedPixels: [],
      stats: {
        parentsInspected: 0,
        pixelsInspected: 0,
        pixelsPassed: 0,
        pixelsFailed: 0,
        comparisonMs: 0,
        authMs: 0,
      },
      verificationMs: Date.now() - started,
    };
  }

  const key = deriveSpatialPixel1Key({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    globalDnaRef: params.globalDnaRef,
    keyId: params.keyId,
    masterSecret: params.masterSecret,
  });

  const cmpStarted = Date.now();
  const pixels: Pixel1Result[] = [];
  let authMs = 0;

  for (const parent of params.failed2x2) {
    if (parent.status !== 'TAMPERED') continue;
    const children = subdivideUnit(
      {
        unitId: parent.cellId,
        scale: 2,
        x: parent.x,
        y: parent.y,
        width: parent.width,
        height: parent.height,
      },
      params.imageWidth,
      params.imageHeight,
      1,
    );

    for (const child of children) {
      if (!containsRect(parent, child)) {
        return {
          ...pixel1Unavailable('PARENT_CHILD_MISMATCH'),
          verificationMs: Date.now() - started,
        };
      }
      const x = child.x;
      const y = child.y;
      const cand = readPixelRgb(params.candidateRgb, params.imageWidth, x, y);

      let enrolledTag: Buffer;
      try {
        enrolledTag = lookupPixel1EnrolledTag(decoded, x, y);
      } catch {
        return {
          ...pixel1Unavailable('INVALID_COORDINATE'),
          verificationMs: Date.now() - started,
        };
      }

      const authStart = Date.now();
      const tagCand = computePixel1AuthTag({
        pixel1Key: key,
        algorithmVersion: algo,
        dnaRecordId: params.dnaRecordId,
        globalDnaRef: params.globalDnaRef,
        parentCellId: parent.cellId,
        x,
        y,
        width: 1,
        height: 1,
        r: cand.r,
        g: cand.g,
        b: cand.b,
        tagBytes: decoded.tagBytes,
      });
      authMs += Date.now() - authStart;

      // Enrolled tag vs candidate HMAC — NOT live HMAC(ref) vs HMAC(cand)
      const status: Pixel1Status = tagsEqual(tagCand, enrolledTag) ? 'AUTHENTIC' : 'TAMPERED';

      pixels.push({
        x,
        y,
        parentCellId: parent.cellId,
        r: cand.r,
        g: cand.g,
        b: cand.b,
        status,
      });
    }
  }

  const tamperedPixels = pixels.filter((p) => p.status === 'TAMPERED');
  const pixelsPassed = pixels.filter((p) => p.status === 'AUTHENTIC').length;

  return {
    derivedEvidenceOnly: true,
    trusted: true,
    localizationUnit: '1x1_pixel',
    localizationClaim: '1x1_pixel',
    productionClaim: '1x1_pixel',
    algorithmVersion: algo,
    cellSize: 1,
    tagBytes: decoded.tagBytes,
    enrolledVerification: true,
    pixels,
    tamperedPixels,
    stats: {
      parentsInspected: params.failed2x2.filter((p) => p.status === 'TAMPERED').length,
      pixelsInspected: pixels.length,
      pixelsPassed,
      pixelsFailed: tamperedPixels.length,
      comparisonMs: Date.now() - cmpStarted,
      authMs,
    },
    verificationMs: Date.now() - started,
  };
}
