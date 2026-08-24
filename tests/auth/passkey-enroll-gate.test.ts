/**
 * Unauthorized passkey enrollment gate.
 * Face + PAD must not add a new credential when the account already has passkeys.
 */
import {
  decideLoginPasskeyPath,
  gatePendingPasskeyEnroll,
} from '../../src/services/auth/webauthn-evaluate';
import {
  attachPendingPasskey,
  consumeWebAuthnSession,
  issueWebAuthnSession,
  mintPendingPasskeyToken,
} from '../../src/services/auth/webauthn.service';
import {
  countWebAuthnByUserId,
  findWebAuthnByCredentialId,
  insertWebAuthnCredential,
} from '../../src/services/auth/webauthn-store';

const USER_A = 'user-a-enroll-gate';
const USER_B = 'user-b-enroll-gate';
const CRED_A = 'cred-a-enroll-gate';
const CRED_B = 'cred-b-enroll-gate';
const CRED_NEW = 'cred-new-enroll-gate';

jest.mock('../../src/services/auth/webauthn-store', () => ({
  countWebAuthnByUserId: jest.fn(),
  findWebAuthnByCredentialId: jest.fn(),
  insertWebAuthnCredential: jest.fn(),
  listWebAuthnByUserId: jest.fn().mockResolvedValue([]),
  updateWebAuthnSignCount: jest.fn(),
}));

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    user: { update: jest.fn().mockResolvedValue({}) },
    $disconnect: jest.fn(),
  },
}));

const mockCount = countWebAuthnByUserId as jest.MockedFunction<typeof countWebAuthnByUserId>;
const mockFind = findWebAuthnByCredentialId as jest.MockedFunction<typeof findWebAuthnByCredentialId>;
const mockInsert = insertWebAuthnCredential as jest.MockedFunction<typeof insertWebAuthnCredential>;

beforeEach(() => {
  jest.clearAllMocks();
  mockCount.mockResolvedValue(0);
  mockFind.mockResolvedValue(null);
  mockInsert.mockResolvedValue(undefined);
});

describe('decideLoginPasskeyPath', () => {
  it('Test 1 — zero passkeys + pending → enroll_pending', () => {
    expect(decideLoginPasskeyPath({
      hasWebauthnSession: false,
      hasPendingToken: true,
      existingPasskeyCount: 0,
    })).toEqual({ action: 'enroll_pending' });
  });

  it('Test 2 — existing passkey + pending → DENY existing_passkey_required', () => {
    expect(decideLoginPasskeyPath({
      hasWebauthnSession: false,
      hasPendingToken: true,
      existingPasskeyCount: 1,
    })).toEqual({ action: 'deny', reason: 'existing_passkey_required' });
  });

  it('Test 3 — existing passkey + webauthnSession → consume_session', () => {
    expect(decideLoginPasskeyPath({
      hasWebauthnSession: true,
      hasPendingToken: true,
      existingPasskeyCount: 1,
    })).toEqual({ action: 'consume_session' });
  });
});

describe('gatePendingPasskeyEnroll', () => {
  it('Test 1 — new account (count 0) → allow', () => {
    expect(gatePendingPasskeyEnroll({
      targetUserId: USER_A,
      existingPasskeyCount: 0,
    })).toEqual({ ok: true });
  });

  it('Test 2 — existing passkey + new pending → DENY', () => {
    expect(gatePendingPasskeyEnroll({
      targetUserId: USER_A,
      existingPasskeyCount: 1,
      pendingCredentialOwnerId: null,
    })).toEqual({ ok: false, reason: 'existing_passkey_required' });
  });

  it('Test 4 — A target + B intended pending → DENY', () => {
    expect(gatePendingPasskeyEnroll({
      targetUserId: USER_A,
      existingPasskeyCount: 0,
      intendedUserId: USER_B,
    })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('Test 5 — B target + A intended pending → DENY', () => {
    expect(gatePendingPasskeyEnroll({
      targetUserId: USER_B,
      existingPasskeyCount: 0,
      intendedUserId: USER_A,
    })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('credential already owned by B cannot attach to A', () => {
    expect(gatePendingPasskeyEnroll({
      targetUserId: USER_A,
      existingPasskeyCount: 0,
      pendingCredentialOwnerId: USER_B,
    })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('idempotent re-attach of A credential when A already has passkeys → allow', () => {
    expect(gatePendingPasskeyEnroll({
      targetUserId: USER_A,
      existingPasskeyCount: 1,
      pendingCredentialOwnerId: USER_A,
    })).toEqual({ ok: true });
  });
});

describe('attachPendingPasskey + session (mocked store)', () => {
  it('Test 1 — new account enrolls one credential for A', async () => {
    mockCount.mockResolvedValue(0);
    mockFind.mockResolvedValue(null);
    const token = mintPendingPasskeyToken({ credentialId: CRED_NEW, intendedUserId: USER_A });
    const result = await attachPendingPasskey(token, USER_A);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.credentialId).toBe(CRED_NEW);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      credentialId: CRED_NEW,
      userId: USER_A,
    }), expect.anything());
  });

  it('Test 2 — existing passkey + pending → DENY, no insert', async () => {
    mockCount.mockResolvedValue(1);
    mockFind.mockResolvedValue(null);
    const token = mintPendingPasskeyToken({ credentialId: CRED_NEW });
    const result = await attachPendingPasskey(token, USER_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('existing_passkey_required');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('Test 3 — face user A + existing Passkey A session → SUCCESS JWT.sub binding path', () => {
    const session = issueWebAuthnSession({ userId: USER_A, credentialId: CRED_A });
    const sess = consumeWebAuthnSession(session, USER_A);
    expect(sess.ok).toBe(true);
    if (sess.ok) {
      expect(sess.userId).toBe(USER_A);
      expect(sess.credentialId).toBe(CRED_A);
    }
  });

  it('Test 4 — A authentication + B intended pending → DENY', async () => {
    mockCount.mockResolvedValue(0);
    const token = mintPendingPasskeyToken({ credentialId: CRED_B, intendedUserId: USER_B });
    const result = await attachPendingPasskey(token, USER_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('mismatch');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('Test 5 — B authentication + A intended pending → DENY', async () => {
    mockCount.mockResolvedValue(0);
    const token = mintPendingPasskeyToken({ credentialId: CRED_A, intendedUserId: USER_A });
    const result = await attachPendingPasskey(token, USER_B);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('mismatch');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('Test 6 — reuse pending token → DENY', async () => {
    mockCount.mockResolvedValue(0);
    mockFind.mockResolvedValue(null);
    const token = mintPendingPasskeyToken({ credentialId: `${CRED_NEW}-reuse` });
    const first = await attachPendingPasskey(token, USER_A);
    expect(first.ok).toBe(true);
    mockFind.mockResolvedValue({
      credentialId: `${CRED_NEW}-reuse`,
      publicKey: 'x',
      userId: USER_A,
      signCount: 0,
      transports: [],
    });
    mockCount.mockResolvedValue(1);
    const second = await attachPendingPasskey(token, USER_A);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(['replayed_assertion', 'existing_passkey_required']).toContain(second.reason);
    }
  });

  it('Test 7 — expired pending token → DENY', async () => {
    mockCount.mockResolvedValue(0);
    const token = mintPendingPasskeyToken({
      credentialId: `${CRED_NEW}-exp`,
      ttlMs: -1,
      iat: Date.now() - 60_000,
    });
    const result = await attachPendingPasskey(token, USER_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired_challenge');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('DB uniqueness — credential already on B cannot attach to A', async () => {
    mockCount.mockResolvedValue(0);
    mockFind.mockResolvedValue({
      credentialId: CRED_B,
      publicKey: 'x',
      userId: USER_B,
      signCount: 0,
      transports: [],
    });
    const token = mintPendingPasskeyToken({ credentialId: CRED_B });
    const result = await attachPendingPasskey(token, USER_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('mismatch');
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
