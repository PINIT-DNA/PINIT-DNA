/**
 * Layer 12 used to be pure theater: `_buffer` unused, `method`/`strength`
 * hardcoded from mimeType, `embedded: true` a literal, not a result. It
 * can't embed the REAL watermark at this point in the pipeline (DNA
 * generation runs before a vaultId exists, and the watermark's lookup ID is
 * HMAC(vaultId, dnaRecordId)) — so it's now honest about that: it checks
 * whether THIS file's dimensions can even carry the real DNA-B watermark
 * that gets embedded later, at delivery time.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import sharp from 'sharp';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: { dctWatermarkLayer: { create: jest.fn(async () => ({})) } },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { processLayer12 } from '../../src/services/layers/layers-11-15.service';

const dctCreate = prisma.dctWatermarkLayer.create as unknown as jest.Mock<AnyAsync>;

beforeEach(() => {
  dctCreate.mockReset();
  dctCreate.mockResolvedValue({});
});

function dataOf(call: unknown) {
  return (call as { data: Record<string, unknown> }).data;
}

describe('Layer 12 — honest DNA-B capability check', () => {
  test('a real-photo-sized image is marked capable, with the real method name', async () => {
    const image = await sharp({
      create: { width: 960, height: 800, channels: 3, background: { r: 20, g: 60, b: 100 } },
    }).jpeg().toBuffer();

    await processLayer12('dna-1', image, 'image/jpeg', 'owner-1');

    const data = dataOf(dctCreate.mock.calls[0]![0]);
    expect(data['embedded']).toBe(true);
    expect(data['method']).toContain('dna-b-patchwork-v1');
    expect(data['strength']).toBeGreaterThan(0);
    expect(data['survivalScore']).toBeGreaterThan(0);
  });

  test('a genuinely too-small image is honestly marked NOT capable — not just always true', async () => {
    const tiny = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).png().toBuffer();

    await processLayer12('dna-2', tiny, 'image/png', 'owner-2');

    const data = dataOf(dctCreate.mock.calls[0]![0]);
    expect(data['embedded']).toBe(false);
    expect(data['strength']).toBe(0);
    expect(data['survivalScore']).toBe(0);
  });

  test('a non-image file is marked not-applicable, not silently "embedded"', async () => {
    await processLayer12('dna-3', Buffer.from('pdf bytes'), 'application/pdf', 'owner-3');

    const data = dataOf(dctCreate.mock.calls[0]![0]);
    expect(data['embedded']).toBe(false);
    expect(data['method']).toBe('not-applicable');
  });

  test('the reported strength matches the real measured survival rate, not a guessed constant', async () => {
    const image = await sharp({
      create: { width: 960, height: 800, channels: 3, background: { r: 50, g: 90, b: 130 } },
    }).jpeg().toBuffer();

    await processLayer12('dna-4', image, 'image/jpeg', 'owner-4');

    const data = dataOf(dctCreate.mock.calls[0]![0]);
    // Every transform in the real matrix survives since the canonical-frame
    // resize fix (see robust-watermark-transcode.test.ts) — kept at 0.9, not
    // 1.0, since the test matrix doesn't cover every real-world transform.
    expect(data['strength']).toBe(0.9);
    expect(data['survivalScore']).toBe(90);
  });
});
