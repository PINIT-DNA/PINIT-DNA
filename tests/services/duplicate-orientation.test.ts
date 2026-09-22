/**
 * The upload duplicate check against a mirrored or turned copy.
 *
 * A perceptual hash does not survive mirroring, so a leaker who flipped a
 * registered image walked past the near-duplicate check and received a second
 * identity for someone else's work. The check now also asks about the other 7
 * orientations of the upload — only when the file as uploaded matched nothing.
 *
 *  1. A mirrored / turned copy of another account's image is blocked, and the
 *     owner is named.
 *  2. An unrelated image is still allowed — the fix must not over-match.
 *  3. The same account may still re-protect its own file, turned or not.
 *  4. Ordinary uploads pay nothing: when the file as uploaded already matches,
 *     no orientation is tried.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import sharp from 'sharp';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findFirst: jest.fn(), findUnique: jest.fn() },
    cryptoLayer: { findFirst: jest.fn() },
    perceptualLayer: { findMany: jest.fn() },
    localFeatureIndex: { findMany: jest.fn(async () => []) },
    duplicateAttempt: { create: jest.fn() },
    user: { findUnique: jest.fn(async () => ({ shortId: 'PINIT-UPLOADER' })) },
  },
}));
jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/services/audit/audit.service', () => ({ auditService: { log: jest.fn(async () => undefined) } }));
jest.mock('../../src/services/identity/identity-embedding.service', () => ({
  identityEmbeddingService: { extractAndVerify: jest.fn(async () => ({ verified: false })) },
}));
jest.mock('../../src/services/tep/tep.service', () => ({
  tepService: { lookupByBytes: jest.fn(async () => null), markRediscovered: jest.fn() },
}));
jest.mock('../../src/services/duplicate/pinit-signature-detector.service', () => ({
  pinitSignatureDetector: { detect: jest.fn(async () => ({ detected: false })) },
}));

import { prisma } from '../../src/lib/prisma';
import { DuplicateCheckService } from '../../src/services/duplicate/duplicate-check.service';
import { PerceptualLayer } from '../../src/services/layers/layer3.perceptual';

const dnaFindFirst = prisma.dnaRecord.findFirst as unknown as jest.Mock<AnyAsync>;
const dnaFindUnique = prisma.dnaRecord.findUnique as unknown as jest.Mock<AnyAsync>;
const cryptoFindFirst = prisma.cryptoLayer.findFirst as unknown as jest.Mock<AnyAsync>;
const perceptualFindMany = prisma.perceptualLayer.findMany as unknown as jest.Mock<AnyAsync>;

const SLOW = 180_000;
const W = 900;
const H = 600;
const UPLOADER = 'user-a';
const req = (sub = UPLOADER) => ({ user: { sub }, headers: {}, ip: '1.2.3.4' } as never);

async function makeImage(seed: number): Promise<Buffer> {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const raw = Buffer.alloc(W * H * 3);
  const fx = 60 + rnd() * 80, fy = 50 + rnd() * 60;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3; const v = 128 + 90 * Math.sin(x / fx) * Math.cos(y / fy);
    raw[i] = Math.max(0, Math.min(255, v + (rnd() - 0.5) * 14));
    raw[i + 1] = Math.max(0, Math.min(255, v * 0.8 + 40 * Math.cos(y / 130)));
    raw[i + 2] = Math.max(0, Math.min(255, 255 - v + 30 * Math.sin((x + y) / 160)));
  }
  const shapes = Array.from({ length: 30 }, () =>
    `<circle cx="${(rnd() * W) | 0}" cy="${(rnd() * H) | 0}" r="${15 + rnd() * 70}" fill="rgb(${(rnd() * 255) | 0},${(rnd() * 255) | 0},${(rnd() * 255) | 0})" fill-opacity="0.55"/>`).join('');
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`) }])
    .png().toBuffer();
}

const OWNER_RECORD = (ownerUserId: string) => ({
  id: 'dna-registered', imageFilename: 'registered.png', createdAt: new Date(), ownerUserId,
  ownerUser: { shortId: 'PINIT-OTHER' },
});

let service: DuplicateCheckService;
let registeredRow: { pHash64: string; aHash64: string; dHash64: string; dnaRecordId: string };
let original: Buffer;
let computeSpy: jest.SpiedFunction<PerceptualLayer['computeFingerprints']>;

beforeEach(async () => {
  jest.clearAllMocks();
  dnaFindFirst.mockResolvedValue(null);          // no exact-hash match
  cryptoFindFirst.mockResolvedValue(null);
  dnaFindUnique.mockResolvedValue(OWNER_RECORD('user-b'));
  service = new DuplicateCheckService();
  original = await makeImage(4242);
  const fp = await new PerceptualLayer().computeFingerprints(original);
  registeredRow = { pHash64: fp.pHash64, aHash64: fp.aHash64, dHash64: fp.dHash64, dnaRecordId: 'dna-registered' };
  perceptualFindMany.mockResolvedValue([registeredRow]);
  computeSpy = jest.spyOn(PerceptualLayer.prototype, 'computeFingerprints');
}, SLOW);

describe('duplicate check — mirrored and turned copies', () => {
  test('a mirrored copy of another account’s image is blocked and the owner named', async () => {
    const mirrored = await sharp(original).flop().png().toBuffer();
    const result = await service.check(mirrored, 'image/png', 'flipped.png', req());

    expect(result.isDuplicate).toBe(true);
    expect(result.matchType).toBe('NEAR_DUPLICATE_PHASH');
    expect(result.ownerShortId).toBe('PINIT-OTHER');
    expect(result.matchedOrientation).toBe('mirror');
  }, SLOW);

  test('a rotated copy is blocked too', async () => {
    const rotated = await sharp(original).rotate(90).png().toBuffer();
    const result = await service.check(rotated, 'image/png', 'turned.png', req());

    expect(result.isDuplicate).toBe(true);
    expect(result.matchedOrientation).toBeDefined();
  }, SLOW);

  test('an unrelated image is still allowed', async () => {
    const other = await makeImage(99001);
    const result = await service.check(other, 'image/png', 'different.png', req());

    expect(result.isDuplicate).toBe(false);
  }, SLOW);

  test('the same account may still re-protect its own file, mirrored', async () => {
    dnaFindUnique.mockResolvedValue(OWNER_RECORD(UPLOADER));
    const mirrored = await sharp(original).flop().png().toBuffer();
    const result = await service.check(mirrored, 'image/png', 'mine-flipped.png', req());

    expect(result.isDuplicate).toBe(false);
  }, SLOW);

  test('an upload that already matches as-is tries no other orientation', async () => {
    computeSpy.mockClear();
    const result = await service.check(original, 'image/png', 'copy.png', req());

    expect(result.isDuplicate).toBe(true);
    expect(result.matchedOrientation).toBeUndefined();
    // one fingerprint computation: the file as uploaded, nothing turned
    expect(computeSpy).toHaveBeenCalledTimes(1);
  }, SLOW);
});
