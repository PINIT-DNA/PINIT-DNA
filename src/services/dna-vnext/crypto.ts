import crypto from 'crypto';
import { dnaVnextConfig } from '../../config/dna-vnext';

export function vnextHmac(parts: Buffer[]): Buffer {
  return crypto.createHmac('sha256', dnaVnextConfig.secret).update(Buffer.concat(parts)).digest();
}

export function watermarkLookupId(vaultId: string, dnaRecordId: string): string {
  return vnextHmac([
    Buffer.from('pinit-dna-b-lookup-v1'),
    Buffer.from(vaultId, 'utf8'),
    Buffer.from(dnaRecordId, 'utf8'),
  ]).subarray(0, 8).toString('hex');
}

export function signWatermarkBody(body: Buffer): Buffer {
  return vnextHmac([Buffer.from('pinit-dna-b-mac-v1'), body]).subarray(0, 16);
}

export function verifyWatermarkMac(body: Buffer, mac: Buffer): boolean {
  const expect = signWatermarkBody(body);
  if (expect.length !== mac.length) return false;
  return crypto.timingSafeEqual(expect, mac);
}

export function regionCommit(params: {
  imageId: string;
  regionId: string;
  cellTags: Buffer[];
}): Buffer {
  return vnextHmac([
    Buffer.from('pinit-dna-a-region-v1'),
    Buffer.from(params.imageId, 'utf8'),
    Buffer.from(params.regionId, 'utf8'),
    ...params.cellTags,
  ]);
}

export function rootCommit(params: {
  imageId: string;
  width: number;
  height: number;
  regionTags: Buffer[];
}): Buffer {
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(params.width >>> 0, 0);
  dims.writeUInt32BE(params.height >>> 0, 4);
  return vnextHmac([
    Buffer.from('pinit-dna-a-root-v1'),
    Buffer.from(params.imageId, 'utf8'),
    dims,
    ...params.regionTags,
  ]);
}

export function hex16(tag: Buffer): string {
  return tag.subarray(0, 8).toString('hex');
}
