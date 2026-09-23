/**
 * Public share-link downloads must carry a watermark that survives
 * recompression, not just the EXIF-only one that any re-save destroys.
 *
 * createTrackedExport() now embeds the DNA-B robust (Patchwork) watermark
 * alongside the existing EXIF + structural-tail layers — additive, not a
 * replacement, and non-fatal if it fails. This exercises the real embed
 * (not a mock) so a regression in either layer's interaction is caught.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import sharp from 'sharp';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    watermarkProfile: { findUnique: jest.fn(async () => null), create: jest.fn() },
    recipientProfile: { findUnique: jest.fn(async () => null) },
    trackedExportPackage: { findUnique: jest.fn(async () => null), create: jest.fn() },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/audit/audit.service', () => ({
  auditService: { log: jest.fn(async () => undefined) },
}));

import { prisma } from '../../src/lib/prisma';
import { TepService } from '../../src/services/tep/tep.service';
import { extractWatermarkLookupId } from '../../src/services/dna-vnext/robust-watermark';
import { watermarkLookupId } from '../../src/services/dna-vnext/crypto';

const watermarkProfileCreate = prisma.watermarkProfile.create as unknown as jest.Mock<AnyAsync>;
const trackedExportCreate = prisma.trackedExportPackage.create as unknown as jest.Mock<AnyAsync>;

async function makeImage(): Promise<Buffer> {
  // Large enough to clear the DNA-B minimum tile capacity (see
  // robust-watermark.ts) — real share-link downloads are essentially always
  // at least this size.
  return sharp({
    create: { width: 640, height: 640, channels: 3, background: { r: 30, g: 90, b: 140 } },
  }).jpeg({ quality: 92 }).toBuffer();
}

let service: TepService;

beforeEach(() => {
  watermarkProfileCreate.mockReset();
  trackedExportCreate.mockReset();
  watermarkProfileCreate.mockResolvedValue({ id: 'profile-1' });
  trackedExportCreate.mockImplementation(async (args: unknown) => ({
    id: 'tep-1',
    ...(args as { data: Record<string, unknown> }).data,
  }));
  service = new TepService();
});

describe('createTrackedExport — DNA-B watermark layer', () => {
  test('embeds a recoverable DNA-B watermark and reports it in embeddedLayers', async () => {
    const fileBuffer = await makeImage();
    const vaultId = 'vault-tep-test';
    const dnaRecordId = 'dna-tep-test';

    const result = await service.createTrackedExport({
      fileBuffer,
      mimeType: 'image/jpeg',
      filename: 'photo.jpg',
      dnaRecordId,
      vaultId,
      shareLinkId: 'share-link-1',
    });

    expect(result.buffer.length).toBeGreaterThan(0);

    // The DB write is what a real caller (share-link controller) reads back
    // to know whether DNA-B is present — assert the flag it would see.
    expect(trackedExportCreate).toHaveBeenCalledTimes(1);
    const writeArgs = trackedExportCreate.mock.calls[0]![0] as { data: { embeddedLayers: Record<string, unknown> } };
    expect(writeArgs.data.embeddedLayers['dnaBWatermark']).toBe(true);

    // Real extraction on the real returned buffer — not asserting the flag,
    // asserting the mark is actually there and actually recoverable.
    const recovered = await extractWatermarkLookupId(result.buffer);
    expect(recovered).toBe(watermarkLookupId(vaultId, dnaRecordId));
  });

  test('a non-image export sets dnaBWatermark: false and is not touched', async () => {
    const result = await service.createTrackedExport({
      fileBuffer: Buffer.from('%PDF-1.4 not a real pdf but mimeType decides the path'),
      mimeType: 'application/pdf',
      filename: 'doc.pdf',
      dnaRecordId: 'dna-tep-pdf',
      vaultId: 'vault-tep-pdf',
      shareLinkId: 'share-link-2',
    });

    expect(result.buffer.length).toBeGreaterThan(0);
    const writeArgs = trackedExportCreate.mock.calls[0]![0] as { data: { embeddedLayers: Record<string, unknown> } };
    expect(writeArgs.data.embeddedLayers['dnaBWatermark']).toBe(false);
  });
});
