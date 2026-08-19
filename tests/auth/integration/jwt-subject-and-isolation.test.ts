/**
 * JWT.sub must be the verified user's own id (never a shortId, never a gallery
 * hit), and one user's token must never surface another user's data. Requires
 * DATABASE_URL_TEST.
 */
import jwt from 'jsonwebtoken';
import { requireTestDb, resetAuthTables, closeTestDb } from './db-setup';
import { freshLivePadEvidence, fakeEmbedding, freshPasskeyToken } from './fixtures';

const run = requireTestDb() ? describe : describe.skip;

run('JWT subject correctness and per-user isolation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let biometricAuthService: any;

  beforeAll(() => {
    ({ biometricAuthService } = require('./service-with-test-db'));
  });

  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('accessToken.sub equals the created user.id, not the shortId', async () => {
    const result = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(700),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-jwt-1'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoded = jwt.decode(result.tokens.accessToken) as { sub?: string; shortId?: string } | null;
    expect(decoded?.sub).toBe(result.user.id);
    expect(decoded?.sub).not.toBe(result.user.shortId);
  }, 30_000);

  it("two different accounts get JWTs with different subjects, each matching only its own user id", async () => {
    const a = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(701),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-jwt-a'),
    });
    const b = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(702),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-jwt-b'),
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const decodedA = jwt.decode(a.tokens.accessToken) as { sub?: string } | null;
    const decodedB = jwt.decode(b.tokens.accessToken) as { sub?: string } | null;
    expect(decodedA?.sub).toBe(a.user.id);
    expect(decodedB?.sub).toBe(b.user.id);
    expect(decodedA?.sub).not.toBe(decodedB?.sub);
  }, 30_000);
});
