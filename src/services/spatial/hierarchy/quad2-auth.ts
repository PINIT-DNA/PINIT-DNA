/**
 * Phase 4C — 2×2 HKDF + position-bound HMAC (lazy, under failed 4×4)
 * Does not modify Phase 1 / 3A / 4B crypto. Uses Phase 3F lpbin serialization only.
 */

import crypto from 'crypto';
import { spatialHierarchyConfig } from '../../../config/spatial-hierarchy';
import { buildCryptoPayload, buildHkdfInfo } from '../crypto-encoding';
import { extractCellRgb } from '../pixel-auth/cell-grid';
import { subdivideUnit } from './unit-grid';
import { containsRect } from './ancestry';
import type { Quad4CellResult } from './quad4-auth';

export const QUAD2_HKDF_INFO = 'pinit-spatial-quad2-hmac-v1';
export const QUAD2_MAC_DOMAIN = 'Q2';

const KEY_BYTES = 32;

export type Quad2CellStatus = 'AUTHENTIC' | 'TAMPERED' | 'UNKNOWN';

export interface Quad2CellResult {
  cellId: number;
  parentCellId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  status: Quad2CellStatus;
}

export interface Quad2LocalizationResult {
  derivedEvidenceOnly: true;
  trusted: boolean;
  /** Internal unit — NOT the public production claim */
  localizationUnit: '2x2_cell';
  /** Public production claim remains 8x8_cell until 4D */
  productionClaim: '8x8_cell';
  algorithmVersion: string;
  cellSize: 2;
  tagBytes: number;
  cells: Quad2CellResult[];
  tamperedCells: Quad2CellResult[];
  stats: {
    parentsInspected: number;
    cellsInspected: number;
    cellsPassed: number;
    cellsFailed: number;
    pixelsReferenced: number;
    comparisonMs: number;
  };
  unavailableReason?: string;
  verificationMs: number;
}

export function deriveSpatialQuad2Key(params: {
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId: string;
  masterSecret: string;
}): Buffer {
  const info = buildHkdfInfo('lpbin-v1.1', QUAD2_HKDF_INFO, [
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

export function computeQuad2ContentHash(cellRgb: Buffer): Buffer {
  return crypto.createHash('sha256').update(cellRgb).digest();
}

export function computeQuad2AuthTag(params: {
  quad2Key: Buffer;
  algorithmVersion: string;
  dnaRecordId: string;
  globalDnaRef: string;
  parentCellId: number;
  cellId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cellRgb: Buffer;
  tagBytes?: number;
}): Buffer {
  const contentHash = computeQuad2ContentHash(params.cellRgb);
  const payload = buildCryptoPayload('lpbin-v1.1', QUAD2_MAC_DOMAIN, [
    { type: 'str', value: params.algorithmVersion },
    { type: 'str', value: params.dnaRecordId },
    { type: 'str', value: params.globalDnaRef },
    { type: 'u32', value: params.parentCellId },
    { type: 'u32', value: params.cellId },
    { type: 'u16', value: params.x },
    { type: 'u16', value: params.y },
    { type: 'u16', value: params.width },
    { type: 'u16', value: params.height },
    { type: 'bytes', value: contentHash },
  ]);
  const full = crypto.createHmac('sha256', params.quad2Key).update(payload).digest();
  const n = params.tagBytes ?? spatialHierarchyConfig.quad2TagBytes;
  return full.subarray(0, n);
}

function tagsEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function quad2Unavailable(reason: string): Quad2LocalizationResult {
  return {
    derivedEvidenceOnly: true,
    trusted: false,
    localizationUnit: '2x2_cell',
    productionClaim: '8x8_cell',
    algorithmVersion: spatialHierarchyConfig.quad2AlgorithmVersion,
    cellSize: 2,
    tagBytes: spatialHierarchyConfig.quad2TagBytes,
    cells: [],
    tamperedCells: [],
    stats: {
      parentsInspected: 0,
      cellsInspected: 0,
      cellsPassed: 0,
      cellsFailed: 0,
      pixelsReferenced: 0,
      comparisonMs: 0,
    },
    unavailableReason: reason,
    verificationMs: 0,
  };
}

/**
 * Lazy 2×2 authentication under failed Phase-4B 4×4 cells.
 * Compares candidate vs enrolled reference RGB with position-bound HMAC.
 */
export function verifyQuad2UnderFailed4x4(params: {
  imageWidth: number;
  imageHeight: number;
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId: string;
  masterSecret: string;
  /** Phase 4B tampered 4×4 cells */
  failed4x4: Quad4CellResult[];
  candidateRgb: Buffer;
  referenceRgb: Buffer;
  orientationPolicy?: string;
}): Quad2LocalizationResult {
  const started = Date.now();
  const algo = spatialHierarchyConfig.quad2AlgorithmVersion;
  const tagBytes = spatialHierarchyConfig.quad2TagBytes;

  if (
    params.orientationPolicy &&
    params.orientationPolicy !== spatialHierarchyConfig.orientationPolicy
  ) {
    return { ...quad2Unavailable('ORIENTATION_POLICY_MISMATCH'), verificationMs: Date.now() - started };
  }

  const expectedLen = params.imageWidth * params.imageHeight * 3;
  if (
    params.candidateRgb.length !== expectedLen ||
    params.referenceRgb.length !== expectedLen
  ) {
    return {
      ...quad2Unavailable('REFERENCE_OR_CANDIDATE_DIMENSION_MISMATCH'),
      verificationMs: Date.now() - started,
    };
  }

  if (!params.failed4x4.length) {
    return {
      derivedEvidenceOnly: true,
      trusted: true,
      localizationUnit: '2x2_cell',
      productionClaim: '8x8_cell',
      algorithmVersion: algo,
      cellSize: 2,
      tagBytes,
      cells: [],
      tamperedCells: [],
      stats: {
        parentsInspected: 0,
        cellsInspected: 0,
        cellsPassed: 0,
        cellsFailed: 0,
        pixelsReferenced: 0,
        comparisonMs: 0,
      },
      verificationMs: Date.now() - started,
    };
  }

  const key = deriveSpatialQuad2Key({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    globalDnaRef: params.globalDnaRef,
    keyId: params.keyId,
    masterSecret: params.masterSecret,
  });

  const cmpStarted = Date.now();
  const cells: Quad2CellResult[] = [];
  let pixelsReferenced = 0;

  for (const parent of params.failed4x4) {
    if (parent.status !== 'TAMPERED') continue;
    const children = subdivideUnit(
      {
        unitId: parent.cellId,
        scale: 4,
        x: parent.x,
        y: parent.y,
        width: parent.width,
        height: parent.height,
      },
      params.imageWidth,
      params.imageHeight,
      2,
    );

    for (const child of children) {
      if (!containsRect(parent, child)) {
        return {
          ...quad2Unavailable('PARENT_CHILD_MISMATCH'),
          verificationMs: Date.now() - started,
        };
      }

      const geom = {
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
      };
      const refRgb = extractCellRgb(
        params.referenceRgb,
        params.imageWidth,
        params.imageHeight,
        geom,
      );
      const candRgb = extractCellRgb(
        params.candidateRgb,
        params.imageWidth,
        params.imageHeight,
        geom,
      );
      pixelsReferenced += child.width * child.height;

      const tagRef = computeQuad2AuthTag({
        quad2Key: key,
        algorithmVersion: algo,
        dnaRecordId: params.dnaRecordId,
        globalDnaRef: params.globalDnaRef,
        parentCellId: parent.cellId,
        cellId: child.unitId,
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
        cellRgb: refRgb,
        tagBytes,
      });
      const tagCand = computeQuad2AuthTag({
        quad2Key: key,
        algorithmVersion: algo,
        dnaRecordId: params.dnaRecordId,
        globalDnaRef: params.globalDnaRef,
        parentCellId: parent.cellId,
        cellId: child.unitId,
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
        cellRgb: candRgb,
        tagBytes,
      });

      const status: Quad2CellStatus = tagsEqual(tagRef, tagCand) ? 'AUTHENTIC' : 'TAMPERED';
      cells.push({
        cellId: child.unitId,
        parentCellId: parent.cellId,
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
        status,
      });
    }
  }

  const tamperedCells = cells.filter((c) => c.status === 'TAMPERED');
  const cellsPassed = cells.filter((c) => c.status === 'AUTHENTIC').length;

  return {
    derivedEvidenceOnly: true,
    trusted: true,
    localizationUnit: '2x2_cell',
    productionClaim: '8x8_cell',
    algorithmVersion: algo,
    cellSize: 2,
    tagBytes,
    cells,
    tamperedCells,
    stats: {
      parentsInspected: params.failed4x4.filter((p) => p.status === 'TAMPERED').length,
      cellsInspected: cells.length,
      cellsPassed,
      cellsFailed: tamperedCells.length,
      pixelsReferenced,
      comparisonMs: Date.now() - cmpStarted,
    },
    verificationMs: Date.now() - started,
  };
}
