/**
 * Trust & lifecycle hardening tests (Node built-in test runner).
 * Uses an isolated SQLite file so local exchange.db is not mutated.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.join(__dirname, 'test-trust.db');
delete process.env.EXCHANGE_DATABASE_URL;
process.env.EXCHANGE_FORCE_SQLITE = '1';
process.env.EXCHANGE_DB_PATH = testDb;
process.env.PAYMENT_MOCK = '1';

if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

const { initDatabase } = await import('../database.js');
const { runSql, getSql, withImmediateTransaction } = await import('../lib/db.js');
const { sealListingSale } = await import('../lib/seal-order.js');
const { authorizeLicenseDownload } = await import('../lib/license-auth.js');
const { recordBridgeEvent, markBridgeEventProcessed, markBridgeEventFailed } = await import('../lib/bridge-events.js');
const { isListingPurchasable, LISTING_STATUS, LICENSE_STATUS, BRIDGE_EVENT } = await import('../lib/lifecycle.js');

before(async () => {
  await initDatabase();
  await runSql(
    `INSERT OR REPLACE INTO users (pinit_id, exchange_id, name, email, role)
     VALUES ('PINIT-SELLER-T', 'PX-T1', 'Seller T', 'seller-t@test.local', 'creator')`,
  );
  await runSql(
    `INSERT OR REPLACE INTO hub_assets (
      asset_id, pinit_id, title, file_type, vertical, preview_url,
      vault_encrypted, dna_record_id, human_percent, ai_percent, badge_tier, protection_status
    ) VALUES ('asset-trust-1', 'PINIT-SELLER-T', 'Trust Asset', 'images', 'images', 'http://x', 1, 'DNA-T', 95, 5, 'Gold', 'protected')`,
  );
  await runSql(
    `INSERT OR REPLACE INTO listings (
      listing_id, asset_id, pinit_id, title, description, vertical, tags,
      price_personal, price_commercial, price_exclusive, price_enterprise,
      ai_training_opt_out, status, badge_tier, human_percent, ai_percent, dna_hash
    ) VALUES (
      'L-TRUST-1', 'asset-trust-1', 'PINIT-SELLER-T', 'Trust Listing', 'desc', 'images', 't',
      49, 149, 899, 2499, 1, 'published', 'Gold', 95, 5, '0xabc'
    )`,
  );
});

after(() => {
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {
    /* ignore windows lock */
  }
});

test('listing lifecycle: draft/pending not purchasable; published is', () => {
  assert.equal(isListingPurchasable('draft'), false);
  assert.equal(isListingPurchasable('protection_pending'), false);
  assert.equal(isListingPurchasable('protection_failed'), false);
  assert.equal(isListingPurchasable('unlisted'), false);
  assert.equal(isListingPurchasable('suspended'), false);
  assert.equal(isListingPurchasable('published'), true);
  assert.equal(isListingPurchasable('live'), true);
});

test('exclusive purchase locks asset; second sale fails', async () => {
  const listing = await getSql('SELECT *, ? as seller_exchange_id FROM listings WHERE listing_id = ?', [
    'PX-T1',
    'L-TRUST-1',
  ]);
  const first = await sealListingSale({
    listing,
    licenseTier: 'exclusive',
    buyerName: 'Buyer One',
    buyerEmail: 'b1@test.local',
    buyerPinitId: 'PINIT-BUYER-1',
    payment: { paymentStatus: 'mock_paid', paymentIntentId: 'PI-EX-1' },
  });
  assert.ok(first.seal_id);
  const lock = await getSql('SELECT * FROM asset_commerce_locks WHERE asset_id = ?', ['asset-trust-1']);
  assert.ok(lock);

  let failed = false;
  try {
    await sealListingSale({
      listing,
      licenseTier: 'commercial',
      buyerName: 'Buyer Two',
      buyerEmail: 'b2@test.local',
      buyerPinitId: 'PINIT-BUYER-2',
      payment: { paymentStatus: 'mock_paid', paymentIntentId: 'PI-EX-2' },
    });
  } catch (err) {
    failed = true;
    assert.equal(err.status, 409);
  }
  assert.equal(failed, true);
});

test('license download auth: wrong buyer / refunded blocked', async () => {
  const order = await getSql('SELECT * FROM orders_sealed WHERE buyer_pinit_id = ?', ['PINIT-BUYER-1']);
  assert.ok(order);

  await assert.rejects(
    () =>
      authorizeLicenseDownload({
        sealId: order.seal_id,
        buyerPinitId: 'PINIT-OTHER',
        buyerEmail: 'other@test.local',
      }),
    (err) => err.status === 403,
  );

  await runSql(
    `UPDATE orders_sealed SET license_status = ?, status = ?, delivery_status = 'revoked' WHERE seal_id = ?`,
    [LICENSE_STATUS.REFUNDED, 'refunded', order.seal_id],
  );

  await assert.rejects(
    () =>
      authorizeLicenseDownload({
        sealId: order.seal_id,
        buyerPinitId: 'PINIT-BUYER-1',
        buyerEmail: 'b1@test.local',
      }),
    (err) => err.status === 403,
  );
});

test('bridge events are idempotent', async () => {
  const a = await recordBridgeEvent({
    eventType: BRIDGE_EVENT.LISTED,
    idempotencyKey: 'LISTED:TEST-IDEMP',
    listingId: 'L-TRUST-1',
    assetId: 'asset-trust-1',
  });
  assert.equal(a.duplicate, false);
  await markBridgeEventProcessed(a.event.id);

  const b = await recordBridgeEvent({
    eventType: BRIDGE_EVENT.LISTED,
    idempotencyKey: 'LISTED:TEST-IDEMP',
    listingId: 'L-TRUST-1',
    assetId: 'asset-trust-1',
  });
  assert.equal(b.duplicate, true);
  assert.equal(b.event.status, 'processed');
});

test('failed bridge event records retry metadata', async () => {
  const { event } = await recordBridgeEvent({
    eventType: BRIDGE_EVENT.SOLD,
    idempotencyKey: 'SOLD:RETRY-TEST',
    listingId: 'L-TRUST-1',
  });
  await markBridgeEventFailed(event.id, 'hub timeout');
  const again = await getSql('SELECT * FROM hub_bridge_events WHERE id = ?', [event.id]);
  assert.equal(again.status, 'failed');
  assert.equal(again.attempt_count, 1);
  assert.ok(again.next_retry_at);
});

test('BEGIN IMMEDIATE serializes exclusive lock insert', async () => {
  await runSql('DELETE FROM asset_commerce_locks WHERE asset_id = ?', ['asset-race']);
  const results = await Promise.allSettled([
    withImmediateTransaction(async ({ runSql: tx, getSql: g }) => {
      const existing = await g('SELECT * FROM asset_commerce_locks WHERE asset_id = ?', ['asset-race']);
      if (existing) throw Object.assign(new Error('locked'), { status: 409 });
      await tx(
        `INSERT INTO asset_commerce_locks (asset_id, lock_type, listing_id, order_id, seal_id)
         VALUES ('asset-race', 'exclusive', 'L-R', 'O-R1', 'S-R1')`,
      );
      return 'ok1';
    }),
    withImmediateTransaction(async ({ runSql: tx, getSql: g }) => {
      const existing = await g('SELECT * FROM asset_commerce_locks WHERE asset_id = ?', ['asset-race']);
      if (existing) throw Object.assign(new Error('locked'), { status: 409 });
      await tx(
        `INSERT INTO asset_commerce_locks (asset_id, lock_type, listing_id, order_id, seal_id)
         VALUES ('asset-race', 'exclusive', 'L-R', 'O-R2', 'S-R2')`,
      );
      return 'ok2';
    }),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  assert.equal(ok, 1);
  assert.equal(rejected, 1);
});
