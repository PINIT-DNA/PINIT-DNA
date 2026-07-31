/**
 * Milestone B Step 1 — deterministic identity unit tests.
 * Same content bytes ⇒ identical L1–L10 identity digests (pure functions + TXT L6).
 */
import {
  computeClaimsDigest,
  computeContentSealHmac,
  computeCrossModalDescriptor,
  computeFamilyId,
  computeLineageMerkleHead,
  computeLocalPatchIdentityDigest,
  computeUniversalContentSeal,
  stableStringify,
} from '../../src/services/dna/deterministic-identity';
import { computeLayer6IdentitySeal } from '../../src/services/engines/base/text-utils';

describe('deterministic-identity (Milestone B Step 1)', () => {
  const secret = 'test-seal-secret';

  it('stableStringify is order-independent', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('claims_digest is identical for same EXIF + L1 (no dnaRecordId)', () => {
    const a = computeClaimsDigest({
      exifData: { Make: 'Test', Model: 'X' },
      layer1HashRef: 'abc123',
    });
    const b = computeClaimsDigest({
      exifData: { Model: 'X', Make: 'Test' },
      layer1HashRef: 'abc123',
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('claims_digest ignores timestamps / record ids not in payload', () => {
    const base = computeClaimsDigest({
      exifData: { Make: 'A' },
      layer1HashRef: 'h1',
    });
    // Calling again with same content yields same digest
    expect(
      computeClaimsDigest({ exifData: { Make: 'A' }, layer1HashRef: 'h1' }),
    ).toBe(base);
  });

  it('content_seal is identical for same L1–L5 digests', () => {
    const digests = ['d1', 'd2', 'd3', 'd4', 'd5'];
    const a = computeContentSealHmac('IMAGE', digests, secret);
    const b = computeContentSealHmac('IMAGE', digests, secret);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('content_seal changes when any L1–L5 digest changes', () => {
    const a = computeContentSealHmac('IMAGE', ['d1', 'd2', 'd3', 'd4', 'd5'], secret);
    const b = computeContentSealHmac('IMAGE', ['d1', 'd2', 'd3', 'd4', 'XX'], secret);
    expect(a).not.toBe(b);
  });

  it('universal L6 seal is identical across different dnaRecordIds (deterministic mode)', () => {
    // DNA_DETERMINISTIC_MODE defaults ON after Milestone B
    const fps = 'a|b|c|d|e';
    const s1 = computeLayer6IdentitySeal('TXT', fps, 'uuid-AAAA', secret);
    const s2 = computeLayer6IdentitySeal('TXT', fps, 'uuid-BBBB', secret);
    expect(s1).toBe(s2);
    expect(s1).toBe(computeUniversalContentSeal('TXT', fps, secret));
  });

  it('family_id / L7 / L9 / L10 are bit-stable for same content', () => {
    const contentId = 'a'.repeat(64);
    const pHash = 'bbbbbbbbbbbbbbbb';
    expect(computeFamilyId(contentId, pHash)).toBe(computeFamilyId(contentId, pHash));
    expect(computeLocalPatchIdentityDigest(contentId, pHash)).toBe(
      computeLocalPatchIdentityDigest(contentId, pHash),
    );
    expect(computeCrossModalDescriptor(contentId, 'image/png')).toBe(
      computeCrossModalDescriptor(contentId, 'image/png'),
    );
    expect(computeLineageMerkleHead(contentId)).toBe(computeLineageMerkleHead(contentId));
  });

  it('runs 100 identical seal computations without variance', () => {
    const digests = ['x1', 'x2', 'x3', 'x4', 'x5'];
    const first = computeContentSealHmac('TXT', digests, secret);
    for (let i = 0; i < 100; i++) {
      expect(computeContentSealHmac('TXT', digests, secret)).toBe(first);
    }
  });
});
