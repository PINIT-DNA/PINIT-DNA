/**
 * The crop/fragment search must find an asset whether its patches are stored as
 * per-patch rows (indexes built before packing) or as one archive (indexes built after).
 *
 * The regression this pins: the search read only the per-patch rows, so an index that
 * had just an archive looked empty and was skipped. Every asset protected after the
 * packing change would have been invisible to "which vault file is this crop from?",
 * with no error and no log — old assets would have kept working, hiding the problem.
 */
import { describe, test, expect, jest, beforeAll, beforeEach } from '@jest/globals';
import sharp from 'sharp';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: { localFeatureIndex: { findMany: jest.fn() } },
}));
jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// The search imports these for paths this test does not take (ORB refinement, vault reads).
jest.mock('../../src/services/vault/vault.service', () => ({ VaultService: class {} }));
jest.mock('../../src/services/ai/ai-embeddings.service', () => ({ aiService: {} }));

import { prisma } from '../../src/lib/prisma';
import { vaultLocalDnaSearchService } from '../../src/services/forensics/vault-local-dna-search.service';
import { localDnaPatchGenerator } from '../../src/services/forensics/local-dna-patch-generator.service';
import { packPatchesToArchive } from '../../src/services/forensics/local-dna-patch-packer.service';
import type { PatchGridResult } from '../../src/services/forensics/local-dna-patch-generator.service';

const findMany = prisma.localFeatureIndex.findMany as unknown as jest.Mock<AnyAsync>;
const SLOW = 180_000;
const OWNER = 'owner-1';
const VAULT = 'vault-archive-only';

let image: Buffer;
let grid: PatchGridResult;

/** A textured image so the patch grid is rich enough to match on. */
async function makeImage(): Promise<Buffer> {
  const W = 640, H = 480;
  let s = 987654321;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const v = 128 + 90 * Math.sin(x / 37) * Math.cos(y / 29);
    raw[i] = Math.max(0, Math.min(255, v + (rnd() - 0.5) * 30));
    raw[i + 1] = Math.max(0, Math.min(255, v * 0.7 + (rnd() - 0.5) * 30));
    raw[i + 2] = Math.max(0, Math.min(255, 255 - v + (rnd() - 0.5) * 30));
  }
  const shapes = Array.from({ length: 30 }, () =>
    `<rect x="${(rnd() * W) | 0}" y="${(rnd() * H) | 0}" width="${20 + rnd() * 80}" height="${20 + rnd() * 80}" fill="rgb(${(rnd() * 255) | 0},${(rnd() * 255) | 0},${(rnd() * 255) | 0})"/>`).join('');
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`) }])
    .png().toBuffer();
}

/** The two storage shapes of one and the same index. */
function indexAsRows() {
  return { vaultId: VAULT, dnaRecordId: 'dna-1', ownerUserId: OWNER, imageWidth: grid.imageWidth, imageHeight: grid.imageHeight,
    patches: grid.patches, patchArchive: null, dnaRecord: { imageFilename: 'original.png' } };
}
function indexAsArchive() {
  const a = packPatchesToArchive(grid.patches);
  return { ...indexAsRows(), patches: [], patchArchive: { blob: a.blob, merkleRoot: a.merkleRoot } };
}

beforeAll(async () => {
  image = await makeImage();
  grid = await localDnaPatchGenerator.generateMultiScaleGrid(image);
}, SLOW);

beforeEach(() => { findMany.mockReset(); });

describe('vault local-DNA search reads both storages', () => {
  test('an index stored as per-patch rows is found (the existing behaviour)', async () => {
    findMany.mockResolvedValue([indexAsRows()]);

    const hits = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.vaultId).toBe(VAULT);
  }, SLOW);

  test('an index stored ONLY as an archive is found too', async () => {
    findMany.mockResolvedValue([indexAsArchive()]);

    const hits = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.vaultId).toBe(VAULT);
  }, SLOW);

  test('the same index scores identically whichever way it is stored', async () => {
    findMany.mockResolvedValue([indexAsRows()]);
    const fromRows = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });
    findMany.mockResolvedValue([indexAsArchive()]);
    const fromArchive = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    expect(fromArchive[0]!.patchMatchCount).toBe(fromRows[0]!.patchMatchCount);
    expect(fromArchive[0]!.vaultPatchCount).toBe(fromRows[0]!.vaultPatchCount);
  }, SLOW);

  test('a cropped probe still finds an archive-only original', async () => {
    findMany.mockResolvedValue([indexAsArchive()]);
    const crop = await sharp(image).extract({ left: 120, top: 90, width: 320, height: 240 }).png().toBuffer();

    const hits = await vaultLocalDnaSearchService.search(crop, OWNER, 'image/png', { skipOrbRefine: true });

    expect(hits.some((h) => h.vaultId === VAULT)).toBe(true);
  }, SLOW);

  test('an archive that fails its Merkle root is not matched against', async () => {
    const idx = indexAsArchive();
    findMany.mockResolvedValue([{ ...idx, patchArchive: { ...idx.patchArchive!, merkleRoot: 'f'.repeat(64) } }]);

    const hits = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    expect(hits).toEqual([]);
  }, SLOW);

  test('the query asks for the archive column, not just per-patch rows', async () => {
    findMany.mockResolvedValue([]);
    await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    const include = (findMany.mock.calls[0]![0] as { include: Record<string, unknown> }).include;
    expect(include['patchArchive']).toBeDefined();
  }, SLOW);
});
