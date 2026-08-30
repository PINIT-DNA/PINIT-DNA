/**
 * Phase 3A — per-image HKDF for pixel cell HMACs + pixel root MAC
 * Phase 3F: info encoding depends on pixelAlgoVersion
 */

import crypto from 'crypto';
import { spatialPixelAuthConfig } from '../../../config/spatial-pixel-auth';
import { PIXEL_HKDF_INFO, PIXEL_ROOT_HKDF_INFO } from './constants';
import {
  buildHkdfInfo,
  encodingForSpatialPixelVersion,
} from '../crypto-encoding';

const KEY_BYTES = 32;

export function deriveSpatialPixelKey(params: {
  dnaRecordId: string;
  ownerUserId: string;
  globalDnaRef: string;
  keyId?: string;
  masterSecret?: string;
  algorithmVersion?: string;
}): Buffer {
  const keyId = params.keyId ?? spatialPixelAuthConfig.keyId;
  const master = params.masterSecret ?? spatialPixelAuthConfig.masterSecret;
  const encoding = encodingForSpatialPixelVersion(
    params.algorithmVersion ?? spatialPixelAuthConfig.algorithmVersion,
  );
  const info = buildHkdfInfo(encoding, PIXEL_HKDF_INFO, [
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

export function deriveSpatialPixelRootMacKey(params: {
  dnaRecordId: string;
  keyId?: string;
  masterSecret?: string;
  algorithmVersion?: string;
}): Buffer {
  const keyId = params.keyId ?? spatialPixelAuthConfig.keyId;
  const master = params.masterSecret ?? spatialPixelAuthConfig.masterSecret;
  const encoding = encodingForSpatialPixelVersion(
    params.algorithmVersion ?? spatialPixelAuthConfig.algorithmVersion,
  );
  const info = buildHkdfInfo(encoding, PIXEL_ROOT_HKDF_INFO, [keyId]);
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
