/**
 * Phase 4B — 4×4 HKDF + position-bound HMAC (lazy, under failed 8×8)
 * Does not modify Phase 1 / 3A crypto. Uses Phase 3F lpbin serialization only.
 */

import crypto from 'crypto';
import {
  spatialHierarchyConfig,
} from '../../../config/spatial-hierarchy';
import { buildCryptoPayload, buildHkdfInfo } from '../crypto-encoding';
import { extractCellRgb } from '../pixel-auth/cell-grid';
import { subdivideUnit } from './unit-grid';
import { containsRect } from './ancestry';
import type { FineCellEntry } from '../pixel-auth/types';

export const QUAD4_HKDF_INFO = 'pinit-spatial-quad4-hmac-v1';
export const QUAD4_MAC_DOMAIN = 'Q4';

const KEY_BYTES = 32;

export type Quad4CellStatus = 'AUTHENTIC' | 'TAMPERED' | 'UNKNOWN';

export interface Quad4CellResult {
  cellId: number;
  parentCellId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  status: Quad4CellStatus;
}

export interface Quad4LocalizationResult {
  derivedEvidenceOnly: true;
  trusted: boolean;
  /** Internal unit — NOT the public production claim */
  localizationUnit: '4x4_cell';
  /** Public production claim remains 8x8_cell until 4D */
  productionClaim: '8x8_cell';
  algorithmVersion: string;
  cellSize: 4;
  tagBytes: number;
  cells: Quad4CellResult[];
  tamperedCells: Quad4CellResult[];
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

export function deriveSpatialQuad4Key(params: {
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId: string;
  masterSecret: string;
}): Buffer {
  const info = buildHkdfInfo('lpbin-v1.1', QUAD4_HKDF_INFO, [
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

export function computeQuad4ContentHash(cellRgb: Buffer): Buffer {
  return crypto.createHash('sha256').update(cellRgb).digest();
}

export function computeQuad4AuthTag(params: {
  quad4Key: Buffer;
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
  const contentHash = computeQuad4ContentHash(params.cellRgb);
  const payload = buildCryptoPayload('lpbin-v1.1', QUAD4_MAC_DOMAIN, [
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
  const full = crypto.createHmac('sha256', params.quad4Key).update(payload).digest();
  const n = params.tagBytes ?? spatialHierarchyConfig.quad4TagBytes;
  return full.subarray(0, n);
}

function tagsEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function quad4Unavailable(reason: string): Quad4LocalizationResult {
  return {
    derivedEvidenceOnly: true,
    trusted: false,
    localizationUnit: '4x4_cell',
    productionClaim: '8x8_cell',
    algorithmVersion: spatialHierarchyConfig.quad4AlgorithmVersion,
    cellSize: 4,
    tagBytes: spatialHierarchyConfig.quad4TagBytes,
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
 * Lazy 4×4 authentication under failed Phase-3A 8×8 cells.
 * Compares candidate vs enrolled reference RGB with position-bound HMAC.
 */
export function verifyQuad4UnderFailed8x8(params: {
  imageWidth: number;
  imageHeight: number;
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId: string;
  masterSecret: string;
  /** Phase 3A tampered 8×8 cells */
  failed8x8: FineCellEntry[];
  candidateRgb: Buffer;
  referenceRgb: Buffer;
  orientationPolicy?: string;
}): Quad4LocalizationResult {
  const started = Date.now();
  const algo = spatialHierarchyConfig.quad4AlgorithmVersion;
  const tagBytes = spatialHierarchyConfig.quad4TagBytes;

  if (
    params.orientationPolicy &&
    params.orientationPolicy !== spatialHierarchyConfig.orientationPolicy
  ) {
    return { ...quad4Unavailable('ORIENTATION_POLICY_MISMATCH'), verificationMs: Date.now() - started };
  }

  const expectedLen = params.imageWidth * params.imageHeight * 3;
  if (
    params.candidateRgb.length !== expectedLen ||
    params.referenceRgb.length !== expectedLen
  ) {
    return {
      ...quad4Unavailable('REFERENCE_OR_CANDIDATE_DIMENSION_MISMATCH'),
      verificationMs: Date.now() - started,
    };
  }

  if (!params.failed8x8.length) {
    return {
      derivedEvidenceOnly: true,
      trusted: true,
      localizationUnit: '4x4_cell',
      productionClaim: '8x8_cell',
      algorithmVersion: algo,
      cellSize: 4,
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

  const key = deriveSpatialQuad4Key({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    globalDnaRef: params.globalDnaRef,
    keyId: params.keyId,
    masterSecret: params.masterSecret,
  });

  const cmpStarted = Date.now();
  const cells: Quad4CellResult[] = [];
  let pixelsReferenced = 0;

  for (const parent of params.failed8x8) {
    if (parent.status !== 'TAMPERED') continue;
    const children = subdivideUnit(
      {
        unitId: parent.cellId,
        scale: 8,
        x: parent.x,
        y: parent.y,
        width: parent.width,
        height: parent.height,
      },
      params.imageWidth,
      params.imageHeight,
      4,
    );

    for (const child of children) {
      if (!containsRect(parent, child)) {
        return {
          ...quad4Unavailable('PARENT_CHILD_MISMATCH'),
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

      const tagRef = computeQuad4AuthTag({
        quad4Key: key,
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
      const tagCand = computeQuad4AuthTag({
        quad4Key: key,
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

      const status: Quad4CellStatus = tagsEqual(tagRef, tagCand) ? 'AUTHENTIC' : 'TAMPERED';
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
    localizationUnit: '4x4_cell',
    productionClaim: '8x8_cell',
    algorithmVersion: algo,
    cellSize: 4,
    tagBytes,
    cells,
    tamperedCells,
    stats: {
      parentsInspected: params.failed8x8.filter((p) => p.status === 'TAMPERED').length,
      cellsInspected: cells.length,
      cellsPassed,
      cellsFailed: tamperedCells.length,
      pixelsReferenced,
      comparisonMs: Date.now() - cmpStarted,
    },
    verificationMs: Date.now() - started,
  };
}
