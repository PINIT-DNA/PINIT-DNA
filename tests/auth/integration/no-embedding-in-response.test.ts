/**
 * Spec §3 / §18 #12 — no biometric embedding may ever reach the client.
 * Walks the ENTIRE register()/login() response recursively looking for anything
 * embedding-shaped, rather than spot-checking known field names (so a future
 * field that accidentally carries one still trips this).
 *
 * Requires DATABASE_URL_TEST. Skips cleanly if unset.
 */
import { requireTestDb, resetAuthTables, closeTestDb } from './db-setup';
import { freshLivePadEvidence, fakeEmbedding, freshPasskeyToken } from './fixtures';
import { issueWebAuthnSession } from '../../../src/services/auth/webauthn.service';

const run = requireTestDb() ? describe : describe.skip;

/** Any 128-length numeric array, or any key whose name suggests biometric material. */
export function findEmbeddingLikeData(value: unknown, pathSoFar = '$'): string[] {
  const hits: string[] = [];

  if (Array.isArray(value)) {
    const numeric = value.filter((v) => typeof v === 'number');
    if (value.length >= 64 && numeric.length === value.length) {
      hits.push(`${pathSoFar} — numeric array of length ${value.length}`);
    }
    value.forEach((v, i) => hits.push(...findEmbeddingLikeData(v, `${pathSoFar}[${i}]`)));
    return hits;
  }

  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/embedding|template|descriptor|faceVector|voiceVector|cipher/i.test(k)) {
        hits.push(`${pathSoFar}.${k} — suspicious key name`);
      }
      hits.push(...findEmbeddingLikeData(v, `${pathSoFar}.${k}`));
    }
  }

  return hits;
}

run('no biometric embedding is returned to the client', () => {
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

  it('register() response contains nothing embedding-shaped', async () => {
    const result = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(900),
      voiceFingerprint: fakeEmbedding(901),
      padEvidence: freshLivePadEvidence(),
      deviceFingerprint: 'device-no-embed-1',
      passkeyPendingToken: freshPasskeyToken('cred-no-embed-1'),
    });
    expect(result.ok).toBe(true);
    expect(findEmbeddingLikeData(result)).toEqual([]);
  }, 30_000);

  it('login() response contains nothing embedding-shaped', async () => {
    const reg = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(902),
      padEvidence: freshLivePadEvidence(),
      deviceFingerprint: 'device-no-embed-2',
      passkeyPendingToken: freshPasskeyToken('cred-no-embed-2'),
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;

    const login = await biometricAuthService.login({
      faceEmbedding: fakeEmbedding(902),
      claimedShortId: reg.user.shortId,
      padEvidence: freshLivePadEvidence(),
      webauthnSession: issueWebAuthnSession({ userId: reg.user.id, credentialId: 'cred-no-embed-2' }),
    });
    expect(login.ok).toBe(true);

    // login() intentionally returns a `fusion` block for the caller; assert it
    // carries no embedding arrays (scores/distances are numbers, not vectors,
    // and the controller does not forward fusion to the HTTP response).
    expect(findEmbeddingLikeData(login)).toEqual([]);
  }, 30_000);

  it('a rejected duplicate registration leaks nothing either', async () => {
    await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(903),
      padEvidence: freshLivePadEvidence(),
      deviceFingerprint: 'device-no-embed-3a',
      passkeyPendingToken: freshPasskeyToken('cred-no-embed-3a'),
    });
    const dup = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(903),
      padEvidence: freshLivePadEvidence(),
      deviceFingerprint: 'device-no-embed-3b',
      passkeyPendingToken: freshPasskeyToken('cred-no-embed-3b'),
    });
    expect(dup.ok).toBe(false);
    expect(findEmbeddingLikeData(dup)).toEqual([]);
  }, 30_000);
});
