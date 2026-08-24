import { sealSaleWithHub, prepareDeliveryWithHub } from '../hub-client.js';
import { tierPrice, applyCouponPercent } from './pricing.js';
import { withImmediateTransaction, runSql, getSql } from './db.js';
import { LISTING_STATUS, LICENSE_STATUS, ORDER_STATUS, BRIDGE_EVENT, isListingPurchasable } from './lifecycle.js';
import { recordBridgeEvent, markBridgeEventProcessed, markBridgeEventFailed } from './bridge-events.js';
import { postAssetActivity } from './asset-activity.js';
import { activeCurrency } from './money.js';
import { downloadLimitForTier, LICENSE_TERMS_VERSION } from './licensing.js';

/**
 * Seal a paid license sale with exclusive locking + bridge events.
 */
export async function sealListingSale({
  listing,
  licenseTier,
  buyerName,
  buyerEmail,
  buyerOrg,
  buyerPinitId,
  couponPercent = 0,
  payment = {},
  termsAcceptedAt = null,
}) {
  let pricePaid = applyCouponPercent(tierPrice(listing, licenseTier), couponPercent);
  const platformFee = Math.round(pricePaid * 0.15 * 100) / 100;
  const creatorNet = Math.round((pricePaid - platformFee) * 100) / 100;

  const sealId = 'SEAL-' + Math.floor(100000 + Math.random() * 900000);
  const orderId = 'ORD-' + Math.floor(10000 + Math.random() * 90000);
  // Currency is stamped per order so a receipt always reflects what was
  // actually charged, even after the platform currency changes.
  const currency = payment.currency || activeCurrency();
  const downloadLimit = downloadLimitForTier(licenseTier);
  const invoiceNumber = `INV-${new Date().getFullYear()}-${sealId.replace('SEAL-', '')}`;
  const buyerId = buyerPinitId || `PINIT-BUYER-${Math.floor(100 + Math.random() * 900)}`;
  const dnaSummary =
    listing.dna_hash ||
    `0x${Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

  const paymentIntentId = payment.paymentIntentId || null;
  const idempotencyKey = paymentIntentId
    ? `SOLD:${paymentIntentId}:${listing.listing_id}`
    : `SOLD:${orderId}:${listing.listing_id}`;

  const { event: soldEvent, duplicate } = await recordBridgeEvent({
    eventType: BRIDGE_EVENT.SOLD,
    idempotencyKey,
    assetId: listing.asset_id,
    listingId: listing.listing_id,
    orderId,
    licenseId: sealId,
    payload: { licenseTier, buyerId },
  });

  if (duplicate && soldEvent?.status === 'processed') {
    const existing = await getSql(
      'SELECT * FROM orders_sealed WHERE payment_intent_id = ? OR order_id = ? LIMIT 1',
      [paymentIntentId, soldEvent.order_id || orderId],
    );
    if (existing) return mapOrderRow(existing);
  }

  await withImmediateTransaction(async ({ runSql: txRun, getSql: txGet }) => {
    const fresh = await txGet('SELECT * FROM listings WHERE listing_id = ?', [listing.listing_id]);
    if (!fresh) {
      const err = new Error('Listing not found');
      err.status = 404;
      throw err;
    }
    if (!isListingPurchasable(fresh.status)) {
      const err = new Error(`Listing is not purchasable (status: ${fresh.status})`);
      err.status = 409;
      throw err;
    }

    const lock = await txGet('SELECT * FROM asset_commerce_locks WHERE asset_id = ?', [fresh.asset_id]);
    if (lock) {
      const err = new Error('Asset is exclusively licensed and locked from further sales');
      err.status = 409;
      throw err;
    }

    if (String(fresh.status).toLowerCase() === LISTING_STATUS.SOLD_EXCLUSIVE) {
      const err = new Error('Listing was sold exclusively');
      err.status = 409;
      throw err;
    }

    const deliveryExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await txRun(
      `INSERT INTO orders_sealed (
        seal_id, order_id, listing_id, asset_id, seller_pinit_id, seller_exchange_id,
        buyer_pinit_id, buyer_name, buyer_email, buyer_org, license_tier,
        price_paid, platform_fee, creator_net, dna_hash_summary, license_terms_version, status,
        payment_status, razorpay_order_id, razorpay_payment_id, payment_intent_id,
        license_status, delivery_status, delivery_expires_at,
        currency, download_limit, download_count, invoice_number,
        terms_version, terms_accepted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'v2.1-provenance', ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?, ?)`,
      [
        sealId,
        orderId,
        fresh.listing_id,
        fresh.asset_id,
        fresh.pinit_id,
        listing.seller_exchange_id || 'PX-772091',
        buyerId,
        buyerName,
        buyerEmail,
        buyerOrg || 'Independent Buyer',
        licenseTier,
        pricePaid,
        platformFee,
        creatorNet,
        dnaSummary,
        ORDER_STATUS.SEALED,
        payment.paymentStatus || 'paid',
        payment.razorpayOrderId || null,
        payment.razorpayPaymentId || null,
        paymentIntentId,
        LICENSE_STATUS.ACTIVE,
        deliveryExpires,
        currency,
        downloadLimit,
        invoiceNumber,
        LICENSE_TERMS_VERSION,
        termsAcceptedAt,
      ],
    );

    await txRun(
      `INSERT INTO tracking_jobs (job_id, seal_id, asset_id, seller_pinit_id, status, matches_found)
       VALUES (?, ?, ?, ?, 'active_monitoring', 0)`,
      [`TRACK-${Math.floor(1000 + Math.random() * 9000)}`, sealId, fresh.asset_id, fresh.pinit_id],
    );

    if (licenseTier === 'exclusive') {
      await txRun(
        `INSERT INTO asset_commerce_locks (asset_id, lock_type, listing_id, order_id, seal_id, locked_at)
         VALUES (?, 'exclusive', ?, ?, ?, CURRENT_TIMESTAMP)`,
        [fresh.asset_id, fresh.listing_id, orderId, sealId],
      );
      await txRun(`UPDATE listings SET status = ? WHERE asset_id = ?`, [
        LISTING_STATUS.SOLD_EXCLUSIVE,
        fresh.asset_id,
      ]);
    }

    // Stub earning row for future payouts
    await txRun(
      `INSERT OR IGNORE INTO seller_earnings (
        id, seller_pinit_id, order_id, seal_id, gross_amount, platform_fee, net_amount, status, asset_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'accrued', ?)`,
      [
        `EAR-${sealId}`,
        fresh.pinit_id,
        orderId,
        sealId,
        pricePaid,
        platformFee,
        creatorNet,
        fresh.asset_id,
      ],
    );
  });

  // Money settled and the licence row now exists. Amounts are business data the
  // creator is entitled to; no buyer identity beyond the Pinit ID is included.
  postAssetActivity([
    {
      assetId: listing.asset_id,
      eventType: 'PAID',
      title: 'Payment settled',
      detail: `Order ${orderId}`,
      payload: { orderId, sealId, gross: pricePaid, platformFee, creatorNet, licenseTier, currency },
    },
    {
      assetId: listing.asset_id,
      eventType: 'LICENSE_CREATED',
      title: `License issued (${licenseTier})`,
      detail: `Seal ${sealId}`,
      payload: { sealId, orderId, licenseTier, buyerPinitId: buyerId || null },
    },
  ]);

  let hubSeal = null;
  let delivery = null;
  try {
    hubSeal = await sealSaleWithHub({
      vaultId: listing.asset_id,
      orderId,
      listingId: listing.listing_id,
      buyerPinitId: buyerId,
      licenseTier,
    });
  } catch (hubErr) {
    console.warn('[seal] Hub seal failed:', hubErr.message);
    hubSeal = { error: hubErr.message, monitoring: 'exchange_local_only' };
    if (soldEvent?.id) await markBridgeEventFailed(soldEvent.id, hubErr.message).catch(() => {});
  }

  try {
    delivery = await prepareDeliveryWithHub({
      vaultId: listing.asset_id,
      orderId,
      listingId: listing.listing_id,
      buyerPinitId: buyerId,
      buyerEmail,
      licenseTier,
    });
    if (delivery?.downloadUrl) {
      await runSql(
        `UPDATE orders_sealed
         SET delivery_url = ?, delivery_token = ?, delivery_status = 'active',
             delivery_issued_at = CURRENT_TIMESTAMP
         WHERE seal_id = ?`,
        [delivery.downloadUrl, delivery.downloadToken || null, sealId],
      );
      const { event: delEvent, duplicate: delDup } = await recordBridgeEvent({
        eventType: BRIDGE_EVENT.DELIVERED,
        idempotencyKey: `DELIVERED:${orderId}`,
        assetId: listing.asset_id,
        listingId: listing.listing_id,
        orderId,
        licenseId: sealId,
      });
      if (!delDup && delEvent?.id) await markBridgeEventProcessed(delEvent.id);

      postAssetActivity({
        assetId: listing.asset_id,
        eventType: 'DELIVERED',
        title: 'Licensed file delivered',
        detail: `Seal ${sealId}`,
        payload: { sealId, orderId, licenseTier },
      });
    }
  } catch (delErr) {
    console.warn('[seal] Hub delivery failed:', delErr.message);
    delivery = { error: delErr.message };
  }

  if (soldEvent?.id) await markBridgeEventProcessed(soldEvent.id).catch(() => {});

  const saved = await getSql('SELECT * FROM orders_sealed WHERE seal_id = ?', [sealId]);
  return {
    ...mapOrderRow(saved),
    title: listing.title,
    badge_tier: listing.badge_tier,
    tracking_job_id: null,
    sealed_at: saved?.sealed_at || new Date().toISOString(),
    hub_seal: hubSeal,
    download_url: delivery?.downloadUrl || saved?.delivery_url || null,
    download_token: delivery?.downloadToken || saved?.delivery_token || null,
    certificate_summary: delivery?.certificateSummary || null,
  };
}

function mapOrderRow(row) {
  if (!row) return null;
  return {
    seal_id: row.seal_id,
    order_id: row.order_id,
    listing_id: row.listing_id,
    asset_id: row.asset_id,
    license_tier: row.license_tier,
    price_paid: row.price_paid,
    platform_fee: row.platform_fee,
    creator_net: row.creator_net,
    buyer_name: row.buyer_name,
    buyer_email: row.buyer_email,
    buyer_org: row.buyer_org,
    buyer_pinit_id: row.buyer_pinit_id,
    dna_hash_summary: row.dna_hash_summary,
    payment_status: row.payment_status,
    license_status: row.license_status || LICENSE_STATUS.ACTIVE,
    status: row.status,
    delivery_status: row.delivery_status,
    delivery_expires_at: row.delivery_expires_at,
    download_url: row.delivery_url,
    download_token: row.delivery_token,
  };
}
