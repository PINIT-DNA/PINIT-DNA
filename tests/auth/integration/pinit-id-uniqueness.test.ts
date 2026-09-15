/**
 * PINIT ID uniqueness and format, across a batch of real registrations.
 * Requires DATABASE_URL_TEST.
 */
import { requireTestDb, resetAuthTables, closeTestDb } from './db-setup';
import { freshLivePadEvidence, fakeEmbedding, freshPasskeyToken } from './fixtures';

const run = requireTestDb() ? describe : describe.skip;
const SHORT_ID_RE = /^PINIT-[A-Z0-9]{8}$/;
const N = 40;

run('PINIT ID uniqueness', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let biometricAuthService: any;

  beforeAll(async () => {
    ({ biometricAuthService } = require('./service-with-test-db'));
    await resetAuthTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it(`registering ${N} distinct people yields ${N} unique, correctly-formatted PINIT IDs`, async () => {
    const shortIds: string[] = [];
    for (let i = 0; i < N; i++) {
      const result = await biometricAuthService.register({
        faceEmbedding: fakeEmbedding(1000 + i),
        padEvidence: freshLivePadEvidence(),
        passkeyPendingToken: freshPasskeyToken(`cred-uniq-${i}`),
      });
      expect(result.ok).toBe(true);
      if (result.ok) shortIds.push(result.user.shortId);
    }
    expect(shortIds).toHaveLength(N);
    expect(new Set(shortIds).size).toBe(N);
    for (const id of shortIds) expect(id).toMatch(SHORT_ID_RE);
  }, 120_000);
});
