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
import { clearIndexCache } from '../../src/services/forensics/local-dna-index-cache';
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

let version = 0;
/**
 * The search reads light index rows first, then the heavy patch data for indexes it does not
 * have cached. Serve both from the given index rows; every call gets a fresh updatedAt so a
 * previous test's cached index is never reused.
 */
function serve(rows: Array<ReturnType<typeof indexAsRows> | ReturnType<typeof indexAsArchive>>) {
  const stamped = rows.map((r, i) => ({ ...r, id: `idx-${i}`, updatedAt: new Date(1_700_000_000_000 + (++version) * 1000), patchCount: r.patches.length || 1 }));
  findMany.mockImplementation(async (...args: unknown[]) => {
    const q = args[0] as { where: { id?: { in: string[] } }; select: Record<string, unknown> };
    if (q.where.id) {
      return stamped.filter((r) => q.where.id!.in.includes(r.id)).map((r) => ({ id: r.id, patches: r.patches, patchArchive: r.patchArchive }));
    }
    return stamped;
  });
}

beforeEach(() => { findMany.mockReset(); clearIndexCache(); });

describe('vault local-DNA search reads both storages', () => {
  test('an index stored as per-patch rows is found (the existing behaviour)', async () => {
    serve([indexAsRows()]);

    const hits = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.vaultId).toBe(VAULT);
  }, SLOW);

  test('an index stored ONLY as an archive is found too', async () => {
    serve([indexAsArchive()]);

    const hits = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.vaultId).toBe(VAULT);
  }, SLOW);

  test('the same index scores identically whichever way it is stored', async () => {
    serve([indexAsRows()]);
    const fromRows = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });
    serve([indexAsArchive()]);
    const fromArchive = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    expect(fromArchive[0]!.patchMatchCount).toBe(fromRows[0]!.patchMatchCount);
    expect(fromArchive[0]!.vaultPatchCount).toBe(fromRows[0]!.vaultPatchCount);
  }, SLOW);

  test('a cropped probe still finds an archive-only original', async () => {
    serve([indexAsArchive()]);
    const crop = await sharp(image).extract({ left: 120, top: 90, width: 320, height: 240 }).png().toBuffer();

    const hits = await vaultLocalDnaSearchService.search(crop, OWNER, 'image/png', { skipOrbRefine: true });

    expect(hits.some((h) => h.vaultId === VAULT)).toBe(true);
  }, SLOW);

  test('an archive that fails its Merkle root is not matched against', async () => {
    const idx = indexAsArchive();
    serve([{ ...idx, patchArchive: { ...idx.patchArchive!, merkleRoot: 'f'.repeat(64) } }]);

    const hits = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    expect(hits).toEqual([]);
  }, SLOW);

  test('the heavy query asks for the archive column, not just per-patch rows', async () => {
    serve([indexAsArchive()]);
    await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });

    const heavy = findMany.mock.calls.map((c) => c[0] as { select?: Record<string, unknown>; where: { id?: unknown } }).find((q) => q.where.id);
    expect(heavy?.select?.['patchArchive']).toBeDefined();
  }, SLOW);

  test('a second search reuses the cached index instead of reloading patches', async () => {
    serve([indexAsArchive()]);
    await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });
    const heavyCalls = () => findMany.mock.calls.filter((c) => (c[0] as { where: { id?: unknown } }).where.id).length;
    expect(heavyCalls()).toBe(1);

    const again = await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });
    expect(heavyCalls()).toBe(1);
    expect(again[0]!.vaultId).toBe(VAULT);
  }, SLOW);

  test('a rebuilt index (new updatedAt) is reloaded, not served stale', async () => {
    serve([indexAsRows()]);
    await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });
    serve([indexAsRows()]); // same id, newer updatedAt
    await vaultLocalDnaSearchService.search(image, OWNER, 'image/png', { skipOrbRefine: true });
    const heavy = findMany.mock.calls.filter((c) => (c[0] as { where: { id?: unknown } }).where.id).length;
    expect(heavy).toBe(2);
  }, SLOW);
});
