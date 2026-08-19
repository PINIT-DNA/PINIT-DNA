/**
 * The orphan-account regression test. attachPendingPasskey used to run AFTER
 * the user-creation transaction committed, so a failed attach left a credential-
 * less account behind. Now the attach is inside the same transaction as
 * everything else, so any failure — duplicate face, duplicate voice, a bad
 * passkey token — must roll back the ENTIRE registration, leaving zero rows.
 *
 * Requires DATABASE_URL_TEST. Skips cleanly if unset.
 */
import { requireTestDb, resetAuthTables, countRows, closeTestDb } from './db-setup';
import { freshLivePadEvidence, fakeEmbedding, fakeEmbeddingNearDuplicate, freshPasskeyToken } from './fixtures';

const run = requireTestDb() ? describe : describe.skip;

async function expectZeroAuthRows() {
  for (const table of ['users', 'biometric_identities', 'face_templates', 'voice_templates', 'fingerprint_templates', 'webauthn_credentials'] as const) {
    expect(await countRows(table)).toBe(0);
  }
}

run('no orphan rows on any registration failure path', () => {
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

  it('face duplicate: first registration succeeds, second (same face) leaves no extra rows', async () => {
    const first = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(10),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-orphan-face-1'),
    });
    expect(first.ok).toBe(true);
    expect(await countRows('users')).toBe(1);

    const second = await biometricAuthService.register({
      faceEmbedding: fakeEmbeddingNearDuplicate(10),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-orphan-face-2'),
    });
    expect(second.ok).toBe(false);
    // Exactly the first account's rows — the rejected second attempt added nothing.
    expect(await countRows('users')).toBe(1);
    expect(await countRows('biometric_identities')).toBe(1);
    expect(await countRows('webauthn_credentials')).toBe(1);
  }, 30_000);

  it('voice duplicate: face is new but voice collides — the whole registration is rejected, zero rows', async () => {
    const first = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(20),
      voiceFingerprint: fakeEmbedding(21),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-orphan-voice-1'),
    });
    expect(first.ok).toBe(true);

    const second = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(22), // different face
      voiceFingerprint: fakeEmbeddingNearDuplicate(21), // same voice as the first account
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-orphan-voice-2'),
    });
    expect(second.ok).toBe(false);
    // Only the first account exists — the voice-duplicate rejection did not
    // leave behind a face-only/credential-only partial account for the second face.
    expect(await countRows('users')).toBe(1);
    expect(await countRows('face_templates')).toBe(1);
    expect(await countRows('voice_templates')).toBe(1);
  }, 30_000);

  it('garbage passkey token fails the pre-tx shape check — throws, zero rows created', async () => {
    await expect(biometricAuthService.register({
      faceEmbedding: fakeEmbedding(30),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: 'not-a-real-signed-token',
    })).rejects.toThrow();
    await expectZeroAuthRows();
  }, 30_000);

  it('passkey attach fails INSIDE the transaction (credential already owned by someone else) — the whole new account rolls back, not just the credential', async () => {
    const owner = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(40),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-orphan-owned'),
    });
    expect(owner.ok).toBe(true);
    expect(await countRows('users')).toBe(1);

    // A different face, but a pending token for the SAME credential — already
    // attached to the first account. attachPendingPasskey's ownership gate
    // rejects this only once it's inside the transaction (the face/voice
    // duplicate checks pass first, since this is a genuinely different person).
    const other = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(41),
      padEvidence: freshLivePadEvidence(),
      passkeyPendingToken: freshPasskeyToken('cred-orphan-owned'),
    });
    expect(other.ok).toBe(false);

    // This is the actual orphan-bug regression: before the fix, the User/
    // BiometricIdentity/FaceTemplate rows for the second (rejected) person
    // would already be committed by the time the passkey attach failed.
    expect(await countRows('users')).toBe(1);
    expect(await countRows('biometric_identities')).toBe(1);
    expect(await countRows('face_templates')).toBe(1);
    expect(await countRows('webauthn_credentials')).toBe(1);
  }, 30_000);
});
