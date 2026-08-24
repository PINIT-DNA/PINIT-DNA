/**
 * Voice 1:N duplicate detection at registration — the new capability this
 * rebuild adds. Row-count/orphan assertions for the voice-collides-different-
 * face case live in no-orphan-on-failure.test.ts. Requires DATABASE_URL_TEST.
 */
import { requireTestDb, resetAuthTables, countRows, closeTestDb } from './db-setup';
import { freshLivePadEvidence, fakeEmbedding, freshPasskeyToken } from './fixtures';

const run = requireTestDb() ? describe : describe.skip;

run('voice duplicate registration', () => {
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

  it('face and voice both new — registration succeeds with a voice template', async () => {
    const result = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(200),
      voiceFingerprint: fakeEmbedding(201),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-voice-new'),
    });
    expect(result.ok).toBe(true);
    expect(await countRows('voice_templates')).toBe(1);
  }, 30_000);

  it('face is new, no voice supplied at all — registration still succeeds (voice is optional)', async () => {
    const result = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(202),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-voice-skip'),
    });
    expect(result.ok).toBe(true);
    expect(await countRows('voice_templates')).toBe(0);
  }, 30_000);
});
