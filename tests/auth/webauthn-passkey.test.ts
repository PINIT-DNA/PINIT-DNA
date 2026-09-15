/**
 * WebAuthn policy tests. These do not run a platform authenticator.
 * Signature verification is @simplewebauthn/server; these gates run first.
 */
import crypto from 'crypto';
import {
  checkChallengeFreshness,
  checkClientData,
  checkCredentialOwnership,
  checkRpId,
  checkSignCount,
  isSimulatedCredentialId,
} from '../../src/services/auth/webauthn-evaluate';
import {
  consumeWebAuthnSession,
  issueWebAuthnSession,
} from '../../src/services/auth/webauthn.service';
import { prisma } from '../../src/lib/prisma';

const USER_A = 'user-a-uuid';
const USER_B = 'user-b-uuid';
const CRED_A = 'credential-a';
const CRED_B = 'credential-b';
const ORIGIN = 'http://localhost:3000';
const RP_ID = 'localhost';

afterAll(async () => {
  await prisma.$disconnect();
});

function clientData(params: { type: string; origin: string; challenge: string }): string {
  return Buffer.from(JSON.stringify(params), 'utf8').toString('base64url');
}

function authenticatorData(rpId: string): string {
  const rpHash = crypto.createHash('sha256').update(rpId).digest();
  const rest = Buffer.alloc(5);
  return Buffer.concat([rpHash, rest]).toString('base64url');
}

describe('WebAuthn credential ownership', () => {
  it('User A credential → A = success', () => {
    expect(checkCredentialOwnership({ claimedUserId: USER_A, credentialUserId: USER_A })).toEqual({ ok: true });
  });

  it('User B credential → B = success', () => {
    expect(checkCredentialOwnership({ claimedUserId: USER_B, credentialUserId: USER_B })).toEqual({ ok: true });
  });

  it('B credential → A = denied (never switch accounts)', () => {
    expect(checkCredentialOwnership({ claimedUserId: USER_A, credentialUserId: USER_B }))
      .toEqual({ ok: false, reason: 'mismatch' });
  });

  it('A credential → B = denied (never switch accounts)', () => {
    expect(checkCredentialOwnership({ claimedUserId: USER_B, credentialUserId: USER_A }))
      .toEqual({ ok: false, reason: 'mismatch' });
  });

  it('invalid / missing credential → denied', () => {
    expect(checkCredentialOwnership({ claimedUserId: USER_A, credentialUserId: null }))
      .toEqual({ ok: false, reason: 'no_credential' });
    expect(checkCredentialOwnership({ claimedUserId: USER_A, credentialUserId: '' }))
      .toEqual({ ok: false, reason: 'no_credential' });
  });
});

describe('WebAuthn + face identity lock', () => {
  it('faceUserId A + credential A → success', () => {
    const token = issueWebAuthnSession({ userId: USER_A, credentialId: CRED_A });
    const sess = consumeWebAuthnSession(token, USER_A);
    expect(sess.ok).toBe(true);
    if (sess.ok) {
      expect(sess.userId).toBe(USER_A);
      expect(sess.credentialId).toBe(CRED_A);
    }
  });

  it('faceUserId A + credential B → DENY', () => {
    const token = issueWebAuthnSession({ userId: USER_B, credentialId: CRED_B });
    const sess = consumeWebAuthnSession(token, USER_A);
    expect(sess.ok).toBe(false);
    if (!sess.ok) expect(sess.reason).toBe('mismatch');
  });

  it('faceUserId B + credential A → DENY', () => {
    const token = issueWebAuthnSession({ userId: USER_A, credentialId: CRED_A });
    const sess = consumeWebAuthnSession(token, USER_B);
    expect(sess.ok).toBe(false);
    if (!sess.ok) expect(sess.reason).toBe('mismatch');
  });
});

describe('WebAuthn clientData origin / challenge', () => {
  const challenge = 'test-challenge-aaa';

  it('matching origin and challenge → success', () => {
    expect(checkClientData({
      clientDataJSON: clientData({ type: 'webauthn.get', origin: ORIGIN, challenge }),
      expectedType: 'webauthn.get',
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
    })).toEqual({ ok: true });
  });

  it('wrong origin → denied', () => {
    expect(checkClientData({
      clientDataJSON: clientData({ type: 'webauthn.get', origin: 'https://evil.example', challenge }),
      expectedType: 'webauthn.get',
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
    })).toEqual({ ok: false, reason: 'wrong_origin' });
  });

  it('wrong challenge → denied', () => {
    expect(checkClientData({
      clientDataJSON: clientData({ type: 'webauthn.get', origin: ORIGIN, challenge: 'other' }),
      expectedType: 'webauthn.get',
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
    })).toEqual({ ok: false, reason: 'wrong_challenge' });
  });
});

describe('WebAuthn RP ID', () => {
  it('matching RP ID → success', () => {
    expect(checkRpId(authenticatorData(RP_ID), RP_ID)).toEqual({ ok: true });
  });

  it('wrong RP ID → denied', () => {
    expect(checkRpId(authenticatorData('evil.example'), RP_ID))
      .toEqual({ ok: false, reason: 'wrong_rp_id' });
  });
});

describe('WebAuthn replay / expiry', () => {
  it('replayed assertion (used challenge) → denied', () => {
    expect(checkChallengeFreshness({ expiresAt: Date.now() + 60_000, used: true }))
      .toEqual({ ok: false, reason: 'replayed_assertion' });
  });

  it('replayed assertion (signCount not increased) → denied', () => {
    expect(checkSignCount(4, 4)).toEqual({ ok: false, reason: 'replay_counter' });
    expect(checkSignCount(4, 3)).toEqual({ ok: false, reason: 'replay_counter' });
  });

  it('fresh increasing counter → success', () => {
    expect(checkSignCount(4, 5)).toEqual({ ok: true });
  });

  it('expired challenge → denied', () => {
    expect(checkChallengeFreshness({ expiresAt: Date.now() - 1, used: false }))
      .toEqual({ ok: false, reason: 'expired_challenge' });
  });

  it('replayed webauthn session token → denied', () => {
    const token = issueWebAuthnSession({ userId: USER_A, credentialId: CRED_A });
    expect(consumeWebAuthnSession(token, USER_A).ok).toBe(true);
    const again = consumeWebAuthnSession(token, USER_A);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('replayed_assertion');
  });

  it('expired webauthn session → denied', () => {
    const token = issueWebAuthnSession({ userId: USER_A, credentialId: CRED_A, ttlMs: -10 });
    const sess = consumeWebAuthnSession(token, USER_A);
    expect(sess.ok).toBe(false);
    if (!sess.ok) expect(sess.reason).toBe('expired_challenge');
  });
});

describe('simulated device hashes are not passkeys', () => {
  it('rejects dev_ and sim_ ids', () => {
    expect(isSimulatedCredentialId('dev_abc123')).toBe(true);
    expect(isSimulatedCredentialId('sim_abc123')).toBe(true);
    expect(isSimulatedCredentialId('')).toBe(true);
    expect(isSimulatedCredentialId('AQkALdhZ...real')).toBe(false);
  });
});
