/**
 * Packed local-DNA patch storage — one compact, Merkle-rooted blob per
 * protected file (image, PDF page, or video frame) instead of one database
 * row per patch tile.
 *
 * Mirrors the same principle `SpatialAuthPackage`/`blockBlob` already uses
 * for the HKCA pixel-auth engine: many small per-region tags, packed into a
 * single binary column with a Merkle root over them, rather than exploding
 * into per-region DB rows. The multi-scale patch grid used for crop/
 * fragment-splice detection never adopted that pattern — a video frame can
 * carry ~2,000+ patches, and at one row per patch (plus four secondary
 * indexes per row for fast lookup) that overhead, not the underlying
 * fingerprint data, is what actually explodes storage for "every frame"
 * video protection.
 *
 * Detection capability is unchanged: the packed archive round-trips to the
 * exact same `PatchFingerprint[]` shape the matching code
 * (fragment-splice-detector.service.ts) already consumes, just unpacked in
 * application memory instead of loaded as separate rows.
 */
import crypto from 'crypto';
import zlib from 'zlib';
import type { PatchFingerprint } from './local-dna-patch-generator.service';

const FORMAT_TAG = 'PDPA1'; // Packed DNA Patch Archive, version 1
const RECORD_BYTES = 28;
const LEAF_PREFIX = Buffer.from('LOCAL-DNA-PATCH-LEAF-v1');
const EMPTY_ROOT_SEED = Buffer.from('LOCAL-DNA-PATCH-EMPTY-ROOT-v1');

function u16be(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(Math.max(0, Math.min(65535, Math.round(n))), 0);
  return b;
}

function hexToFixedBuffer(hex: string, byteLen: number): Buffer {
  const b = Buffer.alloc(byteLen);
  const clean = (hex || '').padStart(byteLen * 2, '0').slice(0, byteLen * 2);
  Buffer.from(clean, 'hex').copy(b);
  return b;
}

function encodePatchRecord(p: PatchFingerprint): Buffer {
  return Buffer.concat([
    u16be(p.gridX),
    u16be(p.gridY),
    u16be(p.scale),
    hexToFixedBuffer(p.pHash16, 8),
    hexToFixedBuffer(p.dHash8, 4),
    hexToFixedBuffer(p.aHash8, 4),
    hexToFixedBuffer(p.edgeSignature, 1),
    Buffer.from([
      Math.max(0, Math.min(255, Math.round(p.colorVector[0]))),
      Math.max(0, Math.min(255, Math.round(p.colorVector[1]))),
      Math.max(0, Math.min(255, Math.round(p.colorVector[2]))),
    ]),
    hexToFixedBuffer(p.frequencySig, 1),
    hexToFixedBuffer(p.textureSig, 1),
  ]);
}

function decodePatchRecord(index: number, record: Buffer): PatchFingerprint {
  let o = 0;
  const gridX = record.readUInt16BE(o); o += 2;
  const gridY = record.readUInt16BE(o); o += 2;
  const scale = record.readUInt16BE(o); o += 2;
  const pHash16 = record.subarray(o, o + 8).toString('hex'); o += 8;
  const dHash8 = record.subarray(o, o + 4).toString('hex'); o += 4;
  const aHash8 = record.subarray(o, o + 4).toString('hex'); o += 4;
  const edgeSignature = record.subarray(o, o + 1).toString('hex'); o += 1;
  const colorVector: [number, number, number] = [record[o]!, record[o + 1]!, record[o + 2]!]; o += 3;
  const frequencySig = record.subarray(o, o + 1).toString('hex'); o += 1;
  const textureSig = record.subarray(o, o + 1).toString('hex'); o += 1;
  return { patchIndex: index, gridX, gridY, scale, pHash16, dHash8, aHash8, edgeSignature, colorVector, frequencySig, textureSig };
}

function hashPatchLeaf(index: number, record: Buffer): Buffer {
  const idxBuf = Buffer.alloc(4);
  idxBuf.writeUInt32BE(index, 0);
  return crypto.createHash('sha256').update(LEAF_PREFIX).update(idxBuf).update(record).digest();
}

function computeMerkleRoot(leaves: Buffer[]): Buffer {
  if (!leaves.length) return crypto.createHash('sha256').update(EMPTY_ROOT_SEED).digest();
  let level = leaves;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 >= level.length
        ? level[i]!
        : crypto.createHash('sha256').update(level[i]!).update(level[i + 1]!).digest());
    }
    level = next;
  }
  return level[0]!;
}

export interface PackedPatchArchive {
  blob: Buffer;
  merkleRoot: string;
  patchCount: number;
  format: string;
  compression: 'gzip';
}

/**
 * Pack a full patch array (already computed by localDnaPatchGenerator) into
 * one gzip-compressed binary blob, plus a Merkle root over the individual
 * patch records for tamper-evidence parity with the HKCA pixel-auth engine.
 * Patches are assumed pre-sorted by patchIndex (generateMultiScaleGrid
 * assigns it sequentially in push order, so array position already matches).
 */
export function packPatchesToArchive(patches: PatchFingerprint[]): PackedPatchArchive {
  const records = patches.map((p) => encodePatchRecord(p));
  const leaves = records.map((r, i) => hashPatchLeaf(i, r));
  const merkleRoot = computeMerkleRoot(leaves).toString('hex');

  const header = Buffer.alloc(5);
  header.write(FORMAT_TAG.slice(0, 1), 0, 'ascii'); // reserved version marker byte
  header.writeUInt32BE(patches.length, 1);
  const raw = Buffer.concat([header, ...records]);
  const blob = zlib.gzipSync(raw);

  return { blob, merkleRoot, patchCount: patches.length, format: FORMAT_TAG, compression: 'gzip' };
}

/** Reverse of packPatchesToArchive — returns the exact same PatchFingerprint[] shape. */
export function unpackPatchesFromArchive(blob: Buffer): PatchFingerprint[] {
  const raw = zlib.gunzipSync(blob);
  const patchCount = raw.readUInt32BE(1);
  const patches: PatchFingerprint[] = [];
  let offset = 5;
  for (let i = 0; i < patchCount; i++) {
    const record = raw.subarray(offset, offset + RECORD_BYTES);
    patches.push(decodePatchRecord(i, record));
    offset += RECORD_BYTES;
  }
  return patches;
}

/** Re-derive the Merkle root from an already-packed blob, to verify it wasn't corrupted/tampered. */
export function merkleRootFromArchive(blob: Buffer): string {
  const patches = unpackPatchesFromArchive(blob);
  const records = patches.map((p) => encodePatchRecord(p));
  const leaves = records.map((r, i) => hashPatchLeaf(i, r));
  return computeMerkleRoot(leaves).toString('hex');
}
