/**
 * VIDEO — the Hub protect path must store the media adapter fingerprints.
 *
 * The image layers (perceptual, structural, stego …) cannot run on an mp4 or a
 * PDF, which is why those media types have their own adapters. Publish Guardian
 * called them; the Hub upload path did not, so `Asset.fingerprints` was NULL for
 * every Hub-protected video and document — 0 of 28 in production.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: { asset: { updateMany: jest.fn() } },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/assets/video-asset-dna.service', () => ({
  buildVideoAssetDna: jest.fn(async () => ({
    engine: 'investigation-video-dna', ffmpegAvailable: true,
    keyframeCount: 3, keyframeHashes: ['a', 'b', 'c'],
    framePHashes: [], sceneFingerprints: [], raw: {},
  })),
}));

jest.mock('../../src/services/assets/document-asset-dna.service', () => ({
  buildDocumentAssetDna: jest.fn(async () => ({ engine: 'document', pageCount: 1 })),
}));

import { prisma } from '../../src/lib/prisma';
import { assetService } from '../../src/services/assets/asset.service';
import { buildVideoAssetDna } from '../../src/services/assets/video-asset-dna.service';
import { buildDocumentAssetDna } from '../../src/services/assets/document-asset-dna.service';

const updateMany = prisma.asset.updateMany as unknown as jest.Mock<AnyAsync>;
const videoDna = buildVideoAssetDna as unknown as jest.Mock<AnyAsync>;
const docDna = buildDocumentAssetDna as unknown as jest.Mock<AnyAsync>;

const OWNER = 'user-a';
const base = { assetId: 'asset-1', ownerUserId: OWNER, buffer: Buffer.from('x'), dnaId: 'dna-1' };

beforeEach(() => {
  updateMany.mockReset();
  updateMany.mockResolvedValue({ count: 1 });
  videoDna.mockClear();
  docDna.mockClear();
});

describe('attachMediaFingerprints', () => {
  test('a video gets the existing video adapter output stored', async () => {
    const result = await assetService.attachMediaFingerprints({
      ...base, mimeType: 'video/mp4', originalFilename: 'Coffee.mp4',
    });

    expect(videoDna).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ engine: 'investigation-video-dna', keyframeCount: 3 });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  test('a document gets the existing document adapter output stored', async () => {
    await assetService.attachMediaFingerprints({
      ...base, mimeType: 'application/pdf', originalFilename: 'brief.pdf',
    });

    expect(docDna).toHaveBeenCalledTimes(1);
    // The adapter is given the DNA record so its output can be tied back to it.
    expect(docDna).toHaveBeenCalledWith(expect.objectContaining({ dnaRecordId: 'dna-1' }));
  });

  test('the write is scoped to the owner, like every other asset write', async () => {
    await assetService.attachMediaFingerprints({
      ...base, mimeType: 'video/mp4', originalFilename: 'Coffee.mp4',
    });

    const arg = updateMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({ id: 'asset-1', ownerUserId: OWNER });
  });

  test('an image is left alone — its layers already cover it', async () => {
    const result = await assetService.attachMediaFingerprints({
      ...base, mimeType: 'image/png', originalFilename: 'photo.png',
    });

    expect(result).toBeNull();
    expect(videoDna).not.toHaveBeenCalled();
    expect(docDna).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('an adapter failure is recorded, not silently swallowed', async () => {
    videoDna.mockRejectedValueOnce(new Error('ffmpeg missing'));

    const result = await assetService.attachMediaFingerprints({
      ...base, mimeType: 'video/mp4', originalFilename: 'Coffee.mp4',
    });

    // A stored error is distinguishable from "never attempted" (NULL).
    expect(result).toMatchObject({ engine: 'video', error: 'generation_failed' });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
