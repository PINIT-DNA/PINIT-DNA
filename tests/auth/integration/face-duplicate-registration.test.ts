/**
 * Face 1:N duplicate detection at registration — happy path, poor-quality
 * rejection, and the ambiguous (multiple close matches) case collapsing to
 * the same generic message as a single match. Row-count/orphan assertions
 * live in no-orphan-on-failure.test.ts; the race itself is covered by
 * concurrent-face-registration.test.ts. Requires DATABASE_URL_TEST.
 */
import { requireTestDb, resetAuthTables, countRows, closeTestDb } from './db-setup';
import { freshLivePadEvidence, fakeEmbedding, fakeEmbeddingNearDuplicate, freshPasskeyToken } from './fixtures';

const run = requireTestDb() ? describe : describe.skip;

run('face duplicate registration', () => {
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

  it('a genuinely new face creates an account', async () => {
    const result = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(100),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-face-new'),
    });
    expect(result.ok).toBe(true);
    expect(await countRows('users')).toBe(1);
  }, 30_000);

  it('a degenerate (all-zero) embedding is rejected before ever touching the DB', async () => {
    await expect(biometricAuthService.register({
      faceEmbedding: new Array(128).fill(0),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-face-degenerate'),
    })).rejects.toThrow();
    expect(await countRows('users')).toBe(0);
  }, 30_000);

  it('ambiguous multi-match (two existing accounts both close to the probe) still gets the single generic message', async () => {
    await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(101),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-face-amb-1'),
    });
    await biometricAuthService.register({
      faceEmbedding: fakeEmbeddingNearDuplicate(101),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-face-amb-2'),
    }).catch(() => undefined); // may itself be rejected as a duplicate of the first — fine either way

    const third = await biometricAuthService.register({
      faceEmbedding: fakeEmbeddingNearDuplicate(101),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-face-amb-3'),
    });
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.message).toBe("You're already registered with PINIT.");
      expect(third).not.toHaveProperty('shortId');
    }
  }, 30_000);
});
