/**
 * Phase 3 — Asset 360 authorization and privacy.
 *
 * Proves:
 *  A. Ownership comes from the JWT alone. A client-supplied ownerUserId /
 *     userId / PINIT ID cannot widen access.
 *  B. A non-owner is indistinguishable from a missing asset (both null → 404),
 *     so the endpoint cannot enumerate asset ids.
 *  C. A VaultRecord.id / DnaRecord.id is not accepted as an asset key.
 *  D. The creator payload never contains buyer email/name/org, raw IP, precise
 *     GPS, device fingerprints, payment-gateway ids, delivery tokens or risk
 *     internals — enforced by SQL projection, asserted here structurally.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const assetFindFirst = jest.fn<AnyAsync>();
const timelineFindMany = jest.fn<AnyAsync>();
const certFindFirst = jest.fn<AnyAsync>();
const monitorFindFirst = jest.fn<AnyAsync>();
const queryRawUnsafe = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    asset: { findFirst: assetFindFirst },
    assetTimelineEvent: { findMany: timelineFindMany },
    certificate: { findFirst: certFindFirst },
    monitorRecord: { findFirst: monitorFindFirst },
    $queryRawUnsafe: queryRawUnsafe,
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getAssetActivityForOwner } from '../../src/services/assets/asset-360.service';

const OWNER = 'owner-user-id';
const OTHER = 'other-user-id';
const ASSET = 'asset-id';

const assetRow = {
  id: ASSET,
  createdAt: new Date(),
  updatedAt: new Date(),
  status: 'PROTECTED',
  assetType: 'IMAGE',
  originalFilename: 'a.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1,
  contentHash: 'h',
  vaultId: 'vault-id',
  dnaId: 'dna-id',
  certificateId: null,
  monitorStatus: 'PENDING',
  monitorJobId: null,
  riskScore: 0,
  riskSeverity: 'LOW',
  discoveriesCount: 0,
  lastScanAt: null,
  lastDiscoveryAt: null,
  sourcePlatform: 'hub',
  ownerUser: { shortId: 'PINIT-OWNER', fullName: 'Owner Name' },
};

describe('Phase 3 — Asset 360 ownership', () => {
  beforeEach(() => {
    assetFindFirst.mockReset();
    timelineFindMany.mockReset().mockResolvedValue([]);
    certFindFirst.mockReset().mockResolvedValue(null);
    monitorFindFirst.mockReset().mockResolvedValue(null);
    queryRawUnsafe.mockReset().mockResolvedValue([]);
  });

  test('scopes the asset lookup by the caller id from the JWT', async () => {
    assetFindFirst.mockResolvedValue(assetRow);
    await getAssetActivityForOwner(ASSET, OWNER);

    const where = (assetFindFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    // Both the asset id AND the owner must be in the same query — ownership is
    // never checked after the fact.
    expect(where).toEqual({ id: ASSET, ownerUserId: OWNER });
  });

  test('returns null for a non-owner (rendered as 404, same as missing)', async () => {
    assetFindFirst.mockResolvedValue(null); // no row matches id + other owner
    expect(await getAssetActivityForOwner(ASSET, OTHER)).toBeNull();
  });

  test('returns null for a missing asset — indistinguishable from a non-owner', async () => {
    assetFindFirst.mockResolvedValue(null);
    expect(await getAssetActivityForOwner('does-not-exist', OWNER)).toBeNull();
  });

  test('rejects empty asset id or empty owner without querying', async () => {
    expect(await getAssetActivityForOwner('', OWNER)).toBeNull();
    expect(await getAssetActivityForOwner(ASSET, '')).toBeNull();
    expect(assetFindFirst).not.toHaveBeenCalled();
  });

  test('a vault/dna id simply does not match an Asset row', async () => {
    assetFindFirst.mockResolvedValue(null);
    expect(await getAssetActivityForOwner('vault-id', OWNER)).toBeNull();
    expect(await getAssetActivityForOwner('dna-id', OWNER)).toBeNull();
  });
});

describe('Phase 3 — Asset 360 privacy', () => {
  beforeEach(() => {
    assetFindFirst.mockReset().mockResolvedValue(assetRow);
    timelineFindMany.mockReset().mockResolvedValue([]);
    certFindFirst.mockReset().mockResolvedValue(null);
    monitorFindFirst.mockReset().mockResolvedValue(null);
    queryRawUnsafe.mockReset().mockResolvedValue([]);
  });

  test('never selects buyer identity, gateway ids or delivery tokens in SQL', async () => {
    await getAssetActivityForOwner(ASSET, OWNER);
    const sqls = queryRawUnsafe.mock.calls.map((c) => String(c[0]));
    expect(sqls.length).toBeGreaterThan(0);

    const forbidden = [
      'buyer_name', 'buyer_email', 'buyer_org',
      'razorpay_order_id', 'razorpay_payment_id', 'payment_intent_id',
      'delivery_token', 'delivery_url', 'buyer_key',
    ];
    for (const sql of sqls) {
      for (const f of forbidden) {
        expect(sql).not.toContain(f);
      }
    }
  });

  test('share analytics select only coarse geography — no IP, GPS or fingerprint', async () => {
    await getAssetActivityForOwner(ASSET, OWNER);
    const shareSql = queryRawUnsafe.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('share_access_logs'));
    expect(shareSql.length).toBeGreaterThan(0);

    for (const sql of shareSql) {
      for (const f of ['ipAddress', 'gpsLat', 'gpsLng', 'gpsFullAddress',
                       'deviceFingerprint', 'canvasFp', 'riskScore', 'riskFactors']) {
        expect(sql).not.toContain(f);
      }
    }

    // Exactly one of them is the geography query, and it selects only the
    // coarse fields. The other is a pure action count.
    const geo = shareSql.filter((s) => s.includes('country'));
    expect(geo).toHaveLength(1);
    expect(geo[0]).toContain('city');
  });

  test('exposes the creator PINIT ID, not the raw internal User.id', async () => {
    const r = await getAssetActivityForOwner(ASSET, OWNER);
    const creator = (r!.overview as { creator: { pinitId: string; name: string } }).creator;
    expect(creator.pinitId).toBe('PINIT-OWNER');
    expect(JSON.stringify(r!.overview)).not.toContain(OWNER);
  });

  test('labels legacy listing counters as seeded so they are not shown as history', async () => {
    const r = await getAssetActivityForOwner(ASSET, OWNER);
    const perf = r!.performance as { listingCounters: { seeded: boolean } };
    expect(perf.listingCounters.seeded).toBe(true);
  });
});
