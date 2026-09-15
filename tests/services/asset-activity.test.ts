/**
 * Phase 2 — canonical asset activity capture.
 *
 * Proves the two rules Asset 360 depends on:
 *  A. Events are keyed on Asset.id only. A VaultRecord.id / DnaRecord.id / any
 *     unknown id is refused, never written.
 *  B. Buyer PII, precise location, device fingerprints, raw network identifiers
 *     and payment-gateway references never reach the stored payload — the
 *     creator reads this timeline.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const assetFindUnique = jest.fn<AnyAsync>();
const timelineCreate = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    asset: { findUnique: assetFindUnique },
    assetTimelineEvent: { create: timelineCreate },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  recordAssetActivity,
  recordAssetActivityBatch,
  scrubPayload,
} from '../../src/services/assets/asset-activity.service';

const ASSET_ID = 'real-asset-id';

describe('Phase 2 — asset activity is keyed on Asset.id', () => {
  beforeEach(() => {
    assetFindUnique.mockReset();
    timelineCreate.mockReset();
    timelineCreate.mockResolvedValue({ id: 'evt-1' });
  });

  test('writes an event for a real Asset.id', async () => {
    assetFindUnique.mockResolvedValue({ id: ASSET_ID });
    const ok = await recordAssetActivity({
      assetId: ASSET_ID,
      eventType: 'CART_ADDED' as never,
      title: 'Added to cart',
    });
    expect(ok).toBe(true);
    expect(timelineCreate).toHaveBeenCalledTimes(1);
    const arg = timelineCreate.mock.calls[0][0] as { data: { assetId: string } };
    expect(arg.data.assetId).toBe(ASSET_ID);
  });

  test('refuses an id that is not an Asset (vault/dna/unknown)', async () => {
    assetFindUnique.mockResolvedValue(null);
    const ok = await recordAssetActivity({
      assetId: 'vault-record-id',
      eventType: 'SOLD' as never,
      title: 'Sold',
    });
    expect(ok).toBe(false);
    expect(timelineCreate).not.toHaveBeenCalled();
  });

  test('ignores empty/missing asset ids without touching the database', async () => {
    expect(await recordAssetActivity({ assetId: '', eventType: 'VIEWED' as never, title: 'x' })).toBe(false);
    expect(await recordAssetActivity({ assetId: null, eventType: 'VIEWED' as never, title: 'x' })).toBe(false);
    expect(assetFindUnique).not.toHaveBeenCalled();
  });

  test('never throws — an audit failure must not fail commerce', async () => {
    assetFindUnique.mockResolvedValue({ id: ASSET_ID });
    timelineCreate.mockRejectedValue(new Error('db down'));
    await expect(
      recordAssetActivity({ assetId: ASSET_ID, eventType: 'PAID' as never, title: 'Paid' }),
    ).resolves.toBe(false);
  });

  test('batch records independently and reports counts', async () => {
    assetFindUnique
      .mockResolvedValueOnce({ id: ASSET_ID })
      .mockResolvedValueOnce(null);
    const r = await recordAssetActivityBatch([
      { assetId: ASSET_ID, eventType: 'VIEWED' as never, title: 'a' },
      { assetId: 'nope', eventType: 'VIEWED' as never, title: 'b' },
    ]);
    expect(r).toEqual({ recorded: 1, skipped: 1 });
  });
});

describe('Phase 2 — payload privacy scrubbing', () => {
  test('strips buyer PII, location, device and gateway identifiers', () => {
    const out = scrubPayload({
      listingId: 'L-1',
      rating: 5,
      buyerPinitId: 'PINIT-ABC',
      buyer_email: 'a@b.com',
      buyer_name: 'Real Name',
      buyer_org: 'ACME',
      ipAddress: '1.2.3.4',
      deviceFingerprint: 'fp-xyz',
      latitude: 17.3,
      longitude: 78.4,
      razorpay_payment_id: 'pay_123',
      riskScore: 88,
      authorization: 'Bearer x',
    }) as Record<string, unknown>;

    // Business data the creator is allowed to see survives.
    expect(out.listingId).toBe('L-1');
    expect(out.rating).toBe(5);
    expect(out.buyerPinitId).toBe('PINIT-ABC');

    // Everything privacy-sensitive is gone.
    for (const k of [
      'buyer_email', 'buyer_name', 'buyer_org', 'ipAddress', 'deviceFingerprint',
      'latitude', 'longitude', 'razorpay_payment_id', 'riskScore', 'authorization',
    ]) {
      expect(out).not.toHaveProperty(k);
    }
  });

  test('scrubs nested structures and arrays', () => {
    const out = scrubPayload({
      order: { id: 'O-1', buyer_email: 'x@y.com', nested: { gps: [1, 2] } },
      lines: [{ sku: 'A', card: '4111' }],
    }) as any;
    expect(out.order.id).toBe('O-1');
    expect(out.order).not.toHaveProperty('buyer_email');
    expect(out.order.nested).not.toHaveProperty('gps');
    expect(out.lines[0].sku).toBe('A');
    expect(out.lines[0]).not.toHaveProperty('card');
  });

  test('is depth-capped so a pathological payload cannot blow the stack', () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 50; i++) { cur.next = {}; cur = cur.next as Record<string, unknown>; }
    expect(() => scrubPayload(deep)).not.toThrow();
  });
});
