/**
 * Spatial Auth Phase 1 — HKDF key derivation
 *
 * Master secret never leaves process env / config.
 * Per-image keys are derived and discarded after use (not stored).
 *
 * Phase 3F: info encoding depends on algorithmVersion
 *   spatial-auth-v1   → colon-joined UTF-8 (legacy)
 *   spatial-auth-v1.1 → length-prefixed binary
 */

import crypto from 'crypto';
import { spatialAuthConfig } from '../../config/spatial-auth';
import { SPATIAL_HKDF_INFO_BLOCK, SPATIAL_HKDF_INFO_ROOT } from './constants';
import {
  buildHkdfInfo,
  encodingForSpatialAuthVersion,
} from './crypto-encoding';

const KEY_BYTES = 32;

export function deriveSpatialBlockKey(params: {
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId?: string;
  masterSecret?: string;
  /** Defaults to current enrollment version; must match package algorithmVersion on verify */
  algorithmVersion?: string;
}): Buffer {
  const keyId = params.keyId ?? spatialAuthConfig.keyId;
  const master = params.masterSecret ?? spatialAuthConfig.masterSecret;
  const encoding = encodingForSpatialAuthVersion(
    params.algorithmVersion ?? spatialAuthConfig.algorithmVersion,
  );
  const info = buildHkdfInfo(encoding, SPATIAL_HKDF_INFO_BLOCK, [
    params.ownerUserId,
    params.globalDnaRef,
    keyId,
  ]);
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(master, 'utf8'),
      Buffer.from(params.dnaRecordId, 'utf8'),
      info,
      KEY_BYTES,
    ),
  );
}

export function deriveSpatialRootMacKey(params: {
  dnaRecordId: string;
  keyId?: string;
  masterSecret?: string;
  algorithmVersion?: string;
}): Buffer {
  const keyId = params.keyId ?? spatialAuthConfig.keyId;
  const master = params.masterSecret ?? spatialAuthConfig.masterSecret;
  const encoding = encodingForSpatialAuthVersion(
    params.algorithmVersion ?? spatialAuthConfig.algorithmVersion,
  );
  const info = buildHkdfInfo(encoding, SPATIAL_HKDF_INFO_ROOT, [keyId]);
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(master, 'utf8'),
      Buffer.from(params.dnaRecordId, 'utf8'),
      info,
      KEY_BYTES,
    ),
  );
}
