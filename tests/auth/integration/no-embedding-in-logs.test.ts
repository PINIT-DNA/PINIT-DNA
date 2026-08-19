/**
 * Spec §13 / §14 / §18 #13 — no biometric embedding may appear in logs.
 * Spies on the real logger during a full register()+login() cycle and walks every
 * logged argument recursively for embedding-shaped data.
 *
 * Requires DATABASE_URL_TEST. Skips cleanly if unset.
 */
import { requireTestDb, resetAuthTables, closeTestDb } from './db-setup';
import { freshLivePadEvidence, fakeEmbedding, freshPasskeyToken } from './fixtures';
import { issueWebAuthnSession } from '../../../src/services/auth/webauthn.service';
import { logger } from '../../../src/lib/logger';

const run = requireTestDb() ? describe : describe.skip;

function findEmbeddingLikeData(value: unknown, pathSoFar = '$'): string[] {
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
      if (/embedding|templateCipher|descriptor|faceVector|voiceVector/i.test(k)) {
        hits.push(`${pathSoFar}.${k} — suspicious key name`);
      }
      hits.push(...findEmbeddingLikeData(v, `${pathSoFar}.${k}`));
    }
  }

  return hits;
}

run('no biometric embedding appears in logs', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let biometricAuthService: any;
  const captured: unknown[] = [];
  const spies: jest.SpyInstance[] = [];

  beforeAll(() => {
    ({ biometricAuthService } = require('./service-with-test-db'));
  });

  beforeEach(async () => {
    await resetAuthTables();
    captured.length = 0;
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      spies.push(
        jest.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
          captured.push(...args);
          return logger;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any),
      );
    }
  });

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies.length = 0;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('a full register + login cycle logs no embedding-shaped data', async () => {
    const reg = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(950),
      voiceFingerprint: fakeEmbedding(951),
      padEvidence: freshLivePadEvidence(),
      deviceFingerprint: 'device-no-log-1',
      passkeyPendingToken: freshPasskeyToken('cred-no-log-1'),
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;

    await biometricAuthService.login({
      faceEmbedding: fakeEmbedding(950),
      claimedShortId: reg.user.shortId,
      padEvidence: freshLivePadEvidence(),
      webauthnSession: issueWebAuthnSession({ userId: reg.user.id, credentialId: 'cred-no-log-1' }),
    });

    expect(captured.length).toBeGreaterThan(0); // proves the spy actually caught logging
    expect(findEmbeddingLikeData(captured)).toEqual([]);
  }, 30_000);

  it('a rejected duplicate registration logs no embedding-shaped data', async () => {
    await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(952),
      padEvidence: freshLivePadEvidence(),
      deviceFingerprint: 'device-no-log-2a',
      passkeyPendingToken: freshPasskeyToken('cred-no-log-2a'),
    });
    captured.length = 0;

    const dup = await biometricAuthService.register({
      faceEmbedding: fakeEmbedding(952),
      padEvidence: freshLivePadEvidence(),
      deviceFingerprint: 'device-no-log-2b',
      passkeyPendingToken: freshPasskeyToken('cred-no-log-2b'),
    });
    expect(dup.ok).toBe(false);
    expect(findEmbeddingLikeData(captured)).toEqual([]);
  }, 30_000);
});
