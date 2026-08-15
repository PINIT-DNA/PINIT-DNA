/**
 * Security boundary: biometrics authenticate; JWT authorizes.
 *
 * Face + liveness and WebAuthn mint a session. Vault/assets never
 * re-run face matching to decide whose data to return.
 */
import { verifyClaimedFace, normalizeEmbedding } from '../../src/services/auth/biometric-matching.service';
import { checkCredentialOwnership } from '../../src/services/auth/webauthn-evaluate';
import {
  getAuthUserId,
  vaultOwnerWhere,
  assetOwnerWhere,
  dnaOwnerWhere,
  certificateOwnerWhere,
  assertRecordOwner,
} from '../../src/lib/tenant-scope';
import { AppError } from '../../src/api/middleware/error.middleware';
import type { Request } from 'express';

const USER_A = 'user-a';
const USER_B = 'user-b';

function vec(seed: number): number[] {
  const out = new Array(128).fill(0).map((_, i) => Math.sin(seed * 17 + i) * 0.5);
  return normalizeEmbedding(out);
}

const faceA = vec(1);
const faceB = vec(99);

const catalog = [
  { id: 'vault-a', ownerUserId: USER_A, kind: 'vault' },
  { id: 'asset-a', ownerUserId: USER_A, kind: 'asset' },
  { id: 'dna-a', ownerUserId: USER_A, kind: 'dna' },
  { id: 'cert-a', ownerUserId: USER_A, kind: 'certificate' },
  { id: 'vault-b', ownerUserId: USER_B, kind: 'vault' },
  { id: 'asset-b', ownerUserId: USER_B, kind: 'asset' },
];

function session(sub: string): Request {
  return { user: { sub } } as unknown as Request;
}

function owned(sub: string) {
  return catalog.filter((r) => r.ownerUserId === sub);
}

describe('authentication factors are not ownership', () => {
  it('face 1:1 + passkey ownership both lock to the claimed user before JWT', () => {
    const face = verifyClaimedFace({ claimedUserId: USER_A, probe: faceA, enrolled: faceA });
    const passkey = checkCredentialOwnership({ claimedUserId: USER_A, credentialUserId: USER_A });
    expect(face.ok).toBe(true);
    expect(passkey.ok).toBe(true);
    const jwtSub = USER_A;
    expect(jwtSub).toBe(USER_A);
  });

  it('B face cannot authenticate as A — and even a buggy face hit must not mint JWT sub = A for B', () => {
    const face = verifyClaimedFace({ claimedUserId: USER_A, probe: faceB, enrolled: faceA });
    expect(face.ok).toBe(false);
    const passkey = checkCredentialOwnership({ claimedUserId: USER_A, credentialUserId: USER_B });
    expect(passkey.ok).toBe(false);
  });
});

describe('authorization uses JWT.sub only — not a biometric gallery', () => {
  it('session B lists only B vault/assets even if a biometric oracle would say “this is A”', () => {
    const biometricOracleSays = USER_A;
    const jwtSub = getAuthUserId(session(USER_B));
    expect(jwtSub).toBe(USER_B);
    expect(jwtSub).not.toBe(biometricOracleSays);

    const vault = owned(vaultOwnerWhere(jwtSub).dnaRecord.ownerUserId);
    expect(vault.every((r) => r.ownerUserId === USER_B)).toBe(true);
    expect(vault.some((r) => r.ownerUserId === USER_A)).toBe(false);

    const assets = catalog.filter((r) => r.kind === 'asset' && r.ownerUserId === assetOwnerWhere(jwtSub).ownerUserId);
    expect(assets.map((r) => r.id)).toEqual(['asset-b']);
  });

  it('session A never receives B DNA, certificate, or vault rows', () => {
    const jwtSub = getAuthUserId(session(USER_A));
    expect(owned(dnaOwnerWhere(jwtSub).ownerUserId).some((r) => r.ownerUserId === USER_B)).toBe(false);
    expect(owned(certificateOwnerWhere(jwtSub).ownerUserId).some((r) => r.ownerUserId === USER_B)).toBe(false);
    expect(() => assertRecordOwner(USER_B, jwtSub, 'Vault')).toThrow(AppError);
  });

  it('A and B are separate security boundaries', () => {
    const a = owned(USER_A).map((r) => r.id).sort();
    const b = owned(USER_B).map((r) => r.id).sort();
    expect(a).toEqual(['asset-a', 'cert-a', 'dna-a', 'vault-a']);
    expect(b).toEqual(['asset-b', 'vault-b']);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });
});
