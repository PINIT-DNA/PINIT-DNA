/**
 * The packed local-DNA patch archive: format, integrity and the shared reader.
 *
 *  A. Round trip — what is packed is what comes back, and the Merkle root is stable.
 *  B. Integrity — a blob that does not match its stored root, or is truncated, has a
 *     bad header, or is not gzip at all, is REFUSED rather than matched against.
 *  C. resolveIndexPatches — the one reader every search must use. Per-patch rows for
 *     old indexes, the archive for new ones, and never a throw: an unusable archive
 *     is "no patches", not a failed search.
 */
import { describe, test, expect, jest } from '@jest/globals';
import zlib from 'zlib';

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  packPatchesToArchive,
  unpackPatchesFromArchive,
  merkleRootFromArchive,
  resolveIndexPatches,
  PatchArchiveError,
} from '../../src/services/forensics/local-dna-patch-packer.service';
import type { PatchFingerprint } from '../../src/services/forensics/local-dna-patch-generator.service';

/** Deterministic patches whose fields are exactly representable in the 28-byte record. */
function makePatches(count: number): PatchFingerprint[] {
  return Array.from({ length: count }, (_, i) => ({
    patchIndex: i,
    gridX: i % 40,
    gridY: Math.floor(i / 40),
    scale: [32, 64, 128][i % 3]!,
    pHash16: (0x0123456789abcdef + i * 7919).toString(16).padStart(16, '0').slice(-16),
    dHash8: (0x1234abcd + i).toString(16).padStart(8, '0').slice(-8),
    aHash8: (0x9876fedc - i).toString(16).padStart(8, '0').slice(-8),
    edgeSignature: (i % 256).toString(16).padStart(2, '0'),
    colorVector: [i % 256, (i * 3) % 256, (i * 7) % 256] as [number, number, number],
    frequencySig: ((i * 5) % 256).toString(16).padStart(2, '0'),
    textureSig: ((i * 11) % 256).toString(16).padStart(2, '0'),
  }));
}

/** Rewrite the decompressed bytes of an archive and recompress it. */
function editArchive(blob: Buffer, edit: (raw: Buffer) => Buffer): Buffer {
  return zlib.gzipSync(edit(zlib.gunzipSync(blob)));
}

describe('A. round trip', () => {
  test('every patch comes back exactly as it went in', () => {
    const patches = makePatches(300);
    const archive = packPatchesToArchive(patches);

    expect(archive.patchCount).toBe(300);
    expect(unpackPatchesFromArchive(archive.blob)).toEqual(patches);
  });

  test('the Merkle root is deterministic and re-derivable from the blob alone', () => {
    const patches = makePatches(257); // odd count exercises the lone-node promotion
    const a = packPatchesToArchive(patches);
    const b = packPatchesToArchive(patches);

    expect(a.merkleRoot).toBe(b.merkleRoot);
    expect(a.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(merkleRootFromArchive(a.blob)).toBe(a.merkleRoot);
  });

  test('changing any one patch changes the root', () => {
    const patches = makePatches(64);
    const changed = patches.map((p, i) => (i === 31 ? { ...p, gridX: p.gridX + 1 } : p));

    expect(packPatchesToArchive(changed).merkleRoot).not.toBe(packPatchesToArchive(patches).merkleRoot);
  });

  test('an empty archive round-trips', () => {
    const archive = packPatchesToArchive([]);
    expect(unpackPatchesFromArchive(archive.blob, archive.merkleRoot)).toEqual([]);
  });
});

describe('B. a blob that cannot be trusted is refused', () => {
  test('the stored root, when given, must match the records actually read', () => {
    const archive = packPatchesToArchive(makePatches(50));

    expect(() => unpackPatchesFromArchive(archive.blob, archive.merkleRoot)).not.toThrow();
    expect(() => unpackPatchesFromArchive(archive.blob, 'f'.repeat(64))).toThrow(PatchArchiveError);
  });

  test('a record altered after packing fails the root check', () => {
    const archive = packPatchesToArchive(makePatches(50));
    // flip one byte inside the 20th record (header is 5 bytes, records are 28)
    const tampered = editArchive(archive.blob, (raw) => {
      const copy = Buffer.from(raw);
      copy[5 + 20 * 28 + 10] = copy[5 + 20 * 28 + 10]! ^ 0xff;
      return copy;
    });

    expect(() => unpackPatchesFromArchive(tampered, archive.merkleRoot)).toThrow(/Merkle root/);
    // and without the root the same blob would have been read silently
    expect(() => unpackPatchesFromArchive(tampered)).not.toThrow();
  });

  test('a truncated archive is refused, not decoded into garbage patches', () => {
    const archive = packPatchesToArchive(makePatches(50));
    const truncated = editArchive(archive.blob, (raw) => raw.subarray(0, raw.length - 28));

    expect(() => unpackPatchesFromArchive(truncated)).toThrow(/does not match/);
  });

  test('a wrong header byte is refused', () => {
    const archive = packPatchesToArchive(makePatches(5));
    const wrong = editArchive(archive.blob, (raw) => {
      const copy = Buffer.from(raw);
      copy[0] = 0x00;
      return copy;
    });

    expect(() => unpackPatchesFromArchive(wrong)).toThrow(/header/);
  });

  test('bytes that are not gzip at all are refused', () => {
    expect(() => unpackPatchesFromArchive(Buffer.from('not an archive'))).toThrow();
  });
});

describe('C. resolveIndexPatches — the one reader every search uses', () => {
  const rows = makePatches(10) as Array<PatchFingerprint>;

  test('an old index keeps reading its per-patch rows', () => {
    expect(resolveIndexPatches({ patches: rows, patchArchive: null })).toBe(rows);
  });

  test('a new index has no rows, only an archive — and is NOT seen as empty', () => {
    const archive = packPatchesToArchive(makePatches(120));
    const got = resolveIndexPatches({ patches: [], patchArchive: { blob: archive.blob, merkleRoot: archive.merkleRoot } });

    expect(got).toHaveLength(120);
  });

  test('rows win when both exist, so a half-migrated index is never double counted', () => {
    const archive = packPatchesToArchive(makePatches(120));
    const got = resolveIndexPatches({ patches: rows, patchArchive: { blob: archive.blob, merkleRoot: archive.merkleRoot } });

    expect(got).toHaveLength(10);
  });

  test('an archive that fails its root is treated as no patches, without throwing', () => {
    const archive = packPatchesToArchive(makePatches(120));
    const tampered = editArchive(archive.blob, (raw) => {
      const copy = Buffer.from(raw);
      copy[5 + 3] = copy[5 + 3]! ^ 0x01;
      return copy;
    });

    expect(resolveIndexPatches({ patches: [], patchArchive: { blob: tampered, merkleRoot: archive.merkleRoot } })).toEqual([]);
  });

  test('a corrupt or missing archive is no patches, not an error', () => {
    expect(resolveIndexPatches({ patches: [], patchArchive: { blob: Buffer.from('garbage'), merkleRoot: 'x' } })).toEqual([]);
    expect(resolveIndexPatches({ patches: [], patchArchive: null })).toEqual([]);
    expect(resolveIndexPatches({ patches: [] })).toEqual([]);
  });
});
