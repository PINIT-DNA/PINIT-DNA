/**
 * Phase 4E — authenticate dense 1×1 tag blob (content hash root + root MAC)
 */

import crypto from 'crypto';
import { buildCryptoPayload, buildHkdfInfo } from '../crypto-encoding';
import type { Pixel1BlobDecoded } from './pixel1-blob';

const ROOT_MAC_DOMAIN = 'PIXEL1-ROOT-MAC-v1';
const ROOT_MAC_HKDF = 'pinit-spatial-pixel1-rootmac-v1';

export function computePixel1AuthRootHex(tags: Buffer): string {
  return crypto.createHash('sha256').update(tags).digest('hex');
}

export function deriveSpatialPixel1RootMacKey(params: {
  dnaRecordId: string;
  keyId: string;
  masterSecret: string;
}): Buffer {
  const info = buildHkdfInfo('lpbin-v1.1', ROOT_MAC_HKDF, [params.keyId]);
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(params.masterSecret, 'utf8'),
      Buffer.from(params.dnaRecordId, 'utf8'),
      info,
      32,
    ),
  );
}

export function computePixel1RootMac(params: {
  dnaRecordId: string;
  ownerUserId: string;
  width: number;
  height: number;
  orientationPolicy: string;
  globalDnaRef: string;
  keyId: string;
  algorithmVersion: string;
  tagBytes: number;
  pixel1AuthRootHex: string;
  masterSecret: string;
}): string {
  const key = deriveSpatialPixel1RootMacKey({
    dnaRecordId: params.dnaRecordId,
    keyId: params.keyId,
    masterSecret: params.masterSecret,
  });
  const payload = buildCryptoPayload('lpbin-v1.1', ROOT_MAC_DOMAIN, [
    { type: 'str', value: params.keyId },
    { type: 'str', value: params.algorithmVersion },
    { type: 'str', value: params.dnaRecordId },
    { type: 'str', value: params.ownerUserId },
    { type: 'u32', value: params.width },
    { type: 'u32', value: params.height },
    { type: 'str', value: params.orientationPolicy },
    { type: 'str', value: params.globalDnaRef },
    { type: 'u16', value: params.tagBytes },
    { type: 'str', value: params.pixel1AuthRootHex },
  ]);
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

export function verifyPixel1RootMac(
  params: Parameters<typeof computePixel1RootMac>[0] & { pixel1RootMac: string },
): boolean {
  const expected = computePixel1RootMac(params);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(params.pixel1RootMac, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyPixel1BlobIntegrity(params: {
  decoded: Pixel1BlobDecoded;
  pixel1AuthRootHex: string;
  pixel1RootMac: string;
  dnaRecordId: string;
  ownerUserId: string;
  orientationPolicy: string;
  globalDnaRef: string;
  keyId: string;
  masterSecret: string;
}): { ok: true } | { ok: false; reason: string } {
  const root = computePixel1AuthRootHex(params.decoded.tags);
  if (root !== params.pixel1AuthRootHex) {
    return { ok: false, reason: 'PIXEL1_ROOT_MISMATCH' };
  }
  const macOk = verifyPixel1RootMac({
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    width: params.decoded.width,
    height: params.decoded.height,
    orientationPolicy: params.orientationPolicy,
    globalDnaRef: params.globalDnaRef,
    keyId: params.keyId,
    algorithmVersion: params.decoded.algorithmVersion,
    tagBytes: params.decoded.tagBytes,
    pixel1AuthRootHex: params.pixel1AuthRootHex,
    masterSecret: params.masterSecret,
    pixel1RootMac: params.pixel1RootMac,
  });
  if (!macOk) return { ok: false, reason: 'INVALID_PIXEL1_PACKAGE' };
  return { ok: true };
}
