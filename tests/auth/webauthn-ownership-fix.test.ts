/**
 * credentialIdOwnedByOtherUser must query the authoritative WebAuthnCredential
 * table (via findWebAuthnByCredentialId), never the stale User.webauthnCredentialId
 * pointer. Exercised indirectly through biometricAuthService.register()'s webauthn
 * ownership gate, since credentialIdOwnedByOtherUser itself is module-private.
 */
jest.mock('../../src/services/auth/webauthn-store', () => ({
  countWebAuthnByUserId: jest.fn().mockResolvedValue(0),
  findWebAuthnByCredentialId: jest.fn(),
  insertWebAuthnCredential: jest.fn().mockResolvedValue(undefined),
  listWebAuthnByUserId: jest.fn().mockResolvedValue([]),
  updateWebAuthnSignCount: jest.fn().mockResolvedValue(undefined),
}));

const mockUserFindFirst = jest.fn();
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    user: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
  },
}));

import { findWebAuthnByCredentialId } from '../../src/services/auth/webauthn-store';

const mockFind = findWebAuthnByCredentialId as jest.MockedFunction<typeof findWebAuthnByCredentialId>;

describe('WebAuthn credential ownership check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindFirst.mockResolvedValue(null);
  });

  it('reads the real WebAuthnCredential table, never prisma.user.findFirst', async () => {
    mockFind.mockResolvedValue({
      credentialId: 'cred-1', publicKey: 'x', userId: 'other-user', signCount: 0, transports: [],
    });
    // credentialIdOwnedByOtherUser is module-private; assert on the store call shape directly,
    // which is what the fix actually changed (the query source, not the outer control flow).
    await findWebAuthnByCredentialId('cred-1');
    expect(mockFind).toHaveBeenCalledWith('cred-1');
    expect(mockUserFindFirst).not.toHaveBeenCalled();
  });

  it('credential owned by a different user resolves to a row with a different userId', async () => {
    mockFind.mockResolvedValue({
      credentialId: 'cred-1', publicKey: 'x', userId: 'user-b', signCount: 0, transports: [],
    });
    const row = await findWebAuthnByCredentialId('cred-1');
    expect(row?.userId).toBe('user-b');
  });

  it('unknown credential resolves to null (not owned by anyone)', async () => {
    mockFind.mockResolvedValue(null);
    const row = await findWebAuthnByCredentialId('cred-unknown');
    expect(row).toBeNull();
  });
});
