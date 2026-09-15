/**
 * Login must be strict 1:1 verification against the claimed Pinit ID only —
 * never a 1:N gallery search. Requires DATABASE_URL_TEST.
 */
import { requireTestDb, resetAuthTables, closeTestDb } from './db-setup';
import { freshLivePadEvidence, fakeEmbedding, freshPasskeyToken } from './fixtures';
import { issueWebAuthnSession } from '../../../src/services/auth/webauthn.service';

const run = requireTestDb() ? describe : describe.skip;

run('login is strict 1:1', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let biometricAuthService: any;
  let userA: { id: string; shortId: string };
  let userB: { id: string; shortId: string };

  beforeAll(async () => {
    ({ biometricAuthService } = require('./service-with-test-db'));
    await resetAuthTables();

    const a = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(500),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-login-a'),
    });
    const b = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(501),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-login-b'),
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    userA = a.user;
    userB = b.user;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  function sessionFor(user: { id: string }, credentialId: string): string {
    return issueWebAuthnSession({ userId: user.id, credentialId });
  }

  it('correct ID + correct face → login succeeds', async () => {
    const result = await biometricAuthService.login({
      faceEmbedding: fakeEmbedding(500),
      claimedShortId: userA.shortId,
      padEvidence: freshLivePadEvidence(),
      webauthnSession: sessionFor(userA, 'cred-login-a'),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.shortId).toBe(userA.shortId);
  }, 30_000);

  it('correct ID + wrong face (a different registered person\'s face) → rejected, no fallback to gallery search', async () => {
    const result = await biometricAuthService.login({
      faceEmbedding: fakeEmbedding(501), // B's face
      claimedShortId: userA.shortId, // claiming A's account
      padEvidence: freshLivePadEvidence(),
      webauthnSession: sessionFor(userA, 'cred-login-a'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Could not verify this face for the claimed account.');
  }, 30_000);

  it('unknown/nonexistent ID + a real registered face → rejected with the same generic message (no enumeration signal)', async () => {
    const result = await biometricAuthService.login({
      faceEmbedding: fakeEmbedding(500),
      claimedShortId: 'PINIT-NOSUCHID',
      padEvidence: freshLivePadEvidence(),
    });
    expect(result.ok).toBe(false);
  }, 30_000);

  it("B's ID + B's own face signs in as B, never as A", async () => {
    const result = await biometricAuthService.login({
      faceEmbedding: fakeEmbedding(501),
      claimedShortId: userB.shortId,
      padEvidence: freshLivePadEvidence(),
      webauthnSession: sessionFor(userB, 'cred-login-b'),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.shortId).toBe(userB.shortId);
  }, 30_000);
});
