/**
 * 1:1 claimed-account verification — login must never switch identity.
 * Thresholds stay at config defaults (faceLogin = 0.48). Architecture is the fix.
 */
import {
  rankFaceMatches,
  isConfidentFaceMatch,
  isFaceVerified1to1,
  verifyClaimedFace,
  normalizeEmbedding,
  euclideanDistance,
  THRESHOLDS,
} from '../../src/services/auth/biometric-matching.service';

function vec(seed: number): number[] {
  const out = new Array(128).fill(0).map((_, i) => Math.sin(seed * 17 + i) * 0.5);
  return normalizeEmbedding(out);
}

const USER_A = 'user-a';
const USER_B = 'user-b';
const faceA = vec(1);
const faceB = vec(99);
const unknown = vec(50);

describe('claimed-account 1:1 verification (login identity)', () => {
  it('A → A: SUCCESS, identity stays A', () => {
    const result = verifyClaimedFace({ claimedUserId: USER_A, probe: faceA, enrolled: faceA });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claimedUserId).toBe(USER_A);
  });

  it('B → B: SUCCESS, identity stays B', () => {
    const result = verifyClaimedFace({ claimedUserId: USER_B, probe: faceB, enrolled: faceB });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claimedUserId).toBe(USER_B);
  });

  it('B attempts A: DENY — never returns matchedUserId B', () => {
    const ranked = rankFaceMatches(faceB, [
      { userId: USER_A, shortId: 'PINIT-A', embedding: faceA },
      { userId: USER_B, shortId: 'PINIT-B', embedding: faceB },
    ]);
    expect(ranked.best?.userId).toBe(USER_B);

    const result = verifyClaimedFace({ claimedUserId: USER_A, probe: faceB, enrolled: faceA });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.claimedUserId).toBe(USER_A);
      expect(result.reason).toBe('mismatch');
    }
  });

  it('A attempts B: DENY — never authenticates as A', () => {
    const result = verifyClaimedFace({ claimedUserId: USER_B, probe: faceA, enrolled: faceB });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.claimedUserId).toBe(USER_B);
  });

  it('unknown face vs claimed A: DENY', () => {
    const result = verifyClaimedFace({ claimedUserId: USER_A, probe: unknown, enrolled: faceA });
    expect(result.ok).toBe(false);
    expect(isFaceVerified1to1(euclideanDistance(unknown, faceA))).toBe(false);
  });

  it('empty gallery (no enrolled template): DENY', () => {
    const result = verifyClaimedFace({ claimedUserId: USER_A, probe: faceA, enrolled: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_template');
  });

  it('one enrolled user + unrelated face: DENY (no “only one user therefore accept”)', () => {
    const ranked = rankFaceMatches(unknown, [
      { userId: USER_A, shortId: 'PINIT-A', embedding: faceA },
    ]);
    expect(ranked.best?.userId).toBe(USER_A);
    expect(ranked.secondDistance).toBe(Infinity);
    expect(isConfidentFaceMatch(ranked.best!.distance, ranked.secondDistance)).toBe(false);

    const result = verifyClaimedFace({ claimedUserId: USER_A, probe: unknown, enrolled: faceA });
    expect(result.ok).toBe(false);
  });

  it('missing claim: DENY', () => {
    const result = verifyClaimedFace({ claimedUserId: '', probe: faceA, enrolled: faceA });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_claim');
  });

  it('uses the configured login threshold, not an ad-hoc number', () => {
    expect(isFaceVerified1to1(THRESHOLDS.faceLogin)).toBe(false);
    expect(isFaceVerified1to1(Math.max(0, THRESHOLDS.faceLogin - 1e-6))).toBe(true);
  });
});
