/**
 * Spatial Auth Phase 1 — Mode A verify service (DB-backed)
 * Phase 4E: loads server-side vault reference RGB (never client-supplied).
 */

import { isSpatialAuthEnabled } from '../../config/spatial-auth';
import {
  isSpatialQuad4AuthEnabled,
  isSpatialQuad2AuthEnabled,
  isSpatialPixel1AuthEnabled,
} from '../../config/spatial-hierarchy';
import { decodeImageForSpatialAuth } from './image-decode';
import { loadSpatialAuthPackage } from './enroll.service';
import { verifyExactSpatialAuth } from './verify-exact';
import { loadVaultSpatialReferenceRgb } from './vault-reference';
import type { ExactSpatialVerificationResult } from './types';

export async function verifyExactSpatialAuthForDna(params: {
  dnaRecordId: string;
  candidateImageBuffer: Buffer;
  primaryScaleOnly?: boolean;
  /**
   * Ignored if provided — clients must not supply reference.
   * Kept only to fail closed if mistakenly passed from untrusted code.
   */
  referenceRgb?: never;
}): Promise<ExactSpatialVerificationResult> {
  const started = Date.now();

  if (!isSpatialAuthEnabled()) {
    return {
      verificationMode: 'EXACT',
      status: 'ERROR',
      matched: false,
      tampered: false,
      dnaRecordId: params.dnaRecordId,
      algorithmVersion: '',
      orientationPolicy: '',
      width: 0,
      height: 0,
      primaryScale: 0,
      blocksChecked: 0,
      blocksPassed: 0,
      blocksFailed: 0,
      merkleRootMatch: false,
      rootMacValid: false,
      packageIntegrityValid: false,
      tamperedBlocks: [],
      exactPassRate: 0,
      detail: 'Spatial auth is disabled (SPATIAL_AUTH_ENABLED=false)',
      verificationMs: Date.now() - started,
    };
  }

  const pkg = await loadSpatialAuthPackage(params.dnaRecordId);
  if (!pkg) {
    return {
      verificationMode: 'EXACT',
      status: 'INVALID_AUTH_PACKAGE',
      matched: false,
      tampered: false,
      dnaRecordId: params.dnaRecordId,
      algorithmVersion: '',
      orientationPolicy: '',
      width: 0,
      height: 0,
      primaryScale: 0,
      blocksChecked: 0,
      blocksPassed: 0,
      blocksFailed: 0,
      merkleRootMatch: false,
      rootMacValid: false,
      packageIntegrityValid: false,
      tamperedBlocks: [],
      exactPassRate: 0,
      detail: 'No SpatialAuthPackage found for this DNA record',
      verificationMs: Date.now() - started,
    };
  }

  const decoded = await decodeImageForSpatialAuth(params.candidateImageBuffer);

  let referenceRgb: Buffer | undefined;
  let referenceWidth: number | undefined;
  let referenceHeight: number | undefined;

  const needsReference =
    isSpatialQuad4AuthEnabled() ||
    isSpatialQuad2AuthEnabled() ||
    isSpatialPixel1AuthEnabled();

  if (needsReference) {
    const ref = await loadVaultSpatialReferenceRgb({
      dnaRecordId: params.dnaRecordId,
      ownerUserId: pkg.ownerUserId,
    });
    if (ref) {
      referenceRgb = ref.referenceRgb;
      referenceWidth = ref.referenceWidth;
      referenceHeight = ref.referenceHeight;
    }
  }

  return verifyExactSpatialAuth({
    packageData: pkg,
    candidateRgb: decoded.rgb,
    candidateWidth: decoded.width,
    candidateHeight: decoded.height,
    primaryScaleOnly: params.primaryScaleOnly,
    referenceRgb,
    referenceWidth,
    referenceHeight,
  });
}
