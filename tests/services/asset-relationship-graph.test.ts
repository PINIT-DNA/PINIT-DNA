import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    asset: { findFirst: jest.fn() },
    evidenceRecord: { findMany: jest.fn() },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { assetService } from '../../src/services/assets/asset.service';
import { AppError } from '../../src/api/middleware/error.middleware';

const assetFindFirst = prisma.asset.findFirst as unknown as jest.Mock<AnyAsync>;
const evidenceFindMany = prisma.evidenceRecord.findMany as unknown as jest.Mock<AnyAsync>;

const OWNER = 'user-a';

/** An asset with nothing attached to it beyond its own row. */
const BARE_ASSET = {
  id: 'asset-1',
  originalFilename: 'Kochi.jpg',
  assetType: 'IMAGE',
  status: 'PROTECTED',
  dnaId: null,
  ownerUser: null,
  campaign: null,
  versions: [],
  platformLinks: [],
  discoveries: [],
  protectedPosts: [],
};

const kinds = (g: { groups: Array<{ kind: string }> }) => g.groups.map((x) => x.kind);

beforeEach(() => {
  assetFindFirst.mockReset();
  evidenceFindMany.mockReset();
  evidenceFindMany.mockResolvedValue([]);
});

describe('asset relationship graph', () => {
  test('an asset with no connections returns no groups at all', async () => {
    assetFindFirst.mockResolvedValueOnce(BARE_ASSET);

    const graph = await assetService.getRelationshipGraph(OWNER, 'asset-1');

    // An empty section reads as "we looked and found nothing"; omitting it is
    // the honest answer.
    expect(graph.groups).toEqual([]);
    expect(graph.totalConnections).toBe(0);
    expect(graph.asset.title).toBe('Kochi.jpg');
  });

  test('reaches the brand through the campaign, not through the asset', async () => {
    assetFindFirst.mockResolvedValueOnce({
      ...BARE_ASSET,
      campaign: {
        id: 'camp-1',
        name: 'Monsoon',
        status: 'ACTIVE',
        client: { id: 'client-1', name: 'Acme' },
        organization: { id: 'org-1', name: 'TCT' },
      },
    });

    const graph = await assetService.getRelationshipGraph(OWNER, 'asset-1');

    expect(kinds(graph)).toEqual(['CAMPAIGN', 'CLIENT', 'ORGANIZATION']);
    expect(graph.groups.find((g) => g.kind === 'CLIENT')?.items[0].label).toBe('Acme');
  });

  test('a campaign with no client contributes no client group', async () => {
    assetFindFirst.mockResolvedValueOnce({
      ...BARE_ASSET,
      campaign: {
        id: 'camp-1', name: 'Internal', status: 'ACTIVE',
        client: null, organization: null,
      },
    });

    const graph = await assetService.getRelationshipGraph(OWNER, 'asset-1');

    expect(kinds(graph)).toEqual(['CAMPAIGN']);
  });

  test('evidence is only looked for once the asset actually has DNA', async () => {
    assetFindFirst.mockResolvedValueOnce(BARE_ASSET); // dnaId: null

    await assetService.getRelationshipGraph(OWNER, 'asset-1');

    expect(evidenceFindMany).not.toHaveBeenCalled();
  });

  test('evidence is matched on the DNA record and scoped to the owner', async () => {
    assetFindFirst.mockResolvedValueOnce({ ...BARE_ASSET, dnaId: 'dna-1' });
    evidenceFindMany.mockResolvedValueOnce([
      { id: 'ev-1', evidenceCode: 'E-1', evidenceType: 'SCREENSHOT', description: 'capture', collectedAt: new Date() },
    ]);

    const graph = await assetService.getRelationshipGraph(OWNER, 'asset-1');

    const where = (evidenceFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ dnaRecordId: 'dna-1', ownerUserId: OWNER });
    expect(kinds(graph)).toContain('EVIDENCE');
  });

  test('counts every connection across groups', async () => {
    assetFindFirst.mockResolvedValueOnce({
      ...BARE_ASSET,
      ownerUser: { id: 'u1', fullName: 'Ashwithareddy', shortId: 'DSPUSQ76' },
      versions: [
        { id: 'v1', versionNumber: 2, originalFilename: 'Kochi.jpg', createdAt: new Date() },
        { id: 'v2', versionNumber: 1, originalFilename: 'Kochi.jpg', createdAt: new Date() },
      ],
      discoveries: [{ id: 'd1', platform: 'web', url: 'https://x.test' }],
    });

    const graph = await assetService.getRelationshipGraph(OWNER, 'asset-1');

    expect(graph.totalConnections).toBe(4); // 1 owner + 2 versions + 1 discovery
    expect(kinds(graph)).toEqual(['OWNER', 'VERSION', 'DISCOVERY']);
  });

  test('another user cannot read this asset graph', async () => {
    assetFindFirst.mockResolvedValueOnce(null);

    await expect(assetService.getRelationshipGraph('user-b', 'asset-1'))
      .rejects.toBeInstanceOf(AppError);
  });
});
