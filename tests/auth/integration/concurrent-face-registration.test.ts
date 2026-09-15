/**
 * THE race-condition regression test. findMatchingFace used to run outside any
 * lock/transaction, so two concurrent registrations with the same face could
 * both see "no match" and both create accounts. This fires genuinely concurrent
 * register() calls (Promise.all, not sequential awaits) against a real Postgres
 * connection pool — the pg_advisory_xact_lock is a real SQL statement, so this
 * is only meaningful against a live database, not a mocked Prisma client.
 *
 * Requires DATABASE_URL_TEST pointed at a disposable Postgres DB with migrations
 * already applied. Skips cleanly (does not fail) if unset.
 */
import { requireTestDb, resetAuthTables, countRows, closeTestDb } from './db-setup';
import { freshLivePadEvidence, fakeEmbedding, freshPasskeyToken } from './fixtures';

const run = requireTestDb() ? describe : describe.skip;

run('concurrent registration with the same face', () => {
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

  function registerAttempt(credentialSuffix: string) {
    return biometricAuthService.register({
      faceEmbedding: fakeEmbedding(1),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken(`cred-race-${credentialSuffix}`),
    });
  }

  it('two simultaneous registrations with the same face create exactly one account', async () => {
    const [a, b] = await Promise.all([registerAttempt('a'), registerAttempt('b')]);
    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok);

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (!rejected[0].ok) {
      expect(rejected[0].status).toBe(409);
      expect(rejected[0].message).toBe("You're already registered with PINIT.");
    }
    expect(await countRows('users')).toBe(1);
    expect(await countRows('biometric_identities')).toBe(1);
    expect(await countRows('face_templates')).toBe(1);
  }, 30_000);

  it('five simultaneous registrations with the same face still create exactly one account', async () => {
    const attempts = ['a', 'b', 'c', 'd', 'e'].map(registerAttempt);
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(4);
    expect(await countRows('users')).toBe(1);
  }, 30_000);
});
