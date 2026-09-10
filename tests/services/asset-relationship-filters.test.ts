import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: { asset: { findMany: jest.fn() } },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { assetService } from '../../src/services/assets/asset.service';

const findMany = prisma.asset.findMany as unknown as jest.Mock<AnyAsync>;
const OWNER = 'user-a';

/** The `where` the service handed Prisma for the last call. */
function lastWhere(): Record<string, unknown> {
  const arg = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
  return arg.where;
}

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe('asset listing by relationship', () => {
  test('is always scoped to the owner, whatever else is asked for', async () => {
    await assetService.list(OWNER, { clientId: 'client-1' });
    expect(lastWhere().ownerUserId).toBe(OWNER);
  });

  test('"assets for this brand" filters through the campaign relation', async () => {
    await assetService.list(OWNER, { clientId: 'client-1' });
    // A campaign always belongs to a client, so this reaches the brand without
    // storing the brand on the asset.
    expect(lastWhere().campaign).toEqual({ is: { clientId: 'client-1' } });
  });

  test('"assets in this campaign" filters directly', async () => {
    await assetService.list(OWNER, { campaignId: 'camp-1' });
    expect(lastWhere().campaignId).toBe('camp-1');
    expect(lastWhere().campaign).toBeUndefined();
  });

  test('"campaign assets" means any asset that belongs to a campaign', async () => {
    await assetService.list(OWNER, { hasCampaign: true });
    expect(lastWhere().campaignId).toEqual({ not: null });
  });

  test('"not campaign work" is a distinct question from "no filter"', async () => {
    await assetService.list(OWNER, { hasCampaign: false });
    expect(lastWhere().campaignId).toBeNull();
  });

  test('a specific campaign wins over the broader brand and has-campaign filters', async () => {
    await assetService.list(OWNER, {
      campaignId: 'camp-1', clientId: 'client-1', hasCampaign: true,
    });
    expect(lastWhere().campaignId).toBe('camp-1');
    expect(lastWhere().campaign).toBeUndefined();
  });

  test('no relationship filter leaves the listing unrestricted', async () => {
    await assetService.list(OWNER, {});
    expect(lastWhere().campaignId).toBeUndefined();
    expect(lastWhere().campaign).toBeUndefined();
  });

  test('the listing carries what each asset belongs to', async () => {
    await assetService.list(OWNER, {});
    const arg = findMany.mock.calls[0][0] as {
      include: { campaign: { select: Record<string, unknown> } };
    };
    expect(arg.include.campaign.select).toHaveProperty('name');
    expect(arg.include.campaign.select).toHaveProperty('client');
  });

  test('page size stays bounded however large a limit is asked for', async () => {
    await assetService.list(OWNER, { limit: 5000 });
    const arg = findMany.mock.calls[0][0] as { take: number };
    expect(arg.take).toBe(100);
  });
});
