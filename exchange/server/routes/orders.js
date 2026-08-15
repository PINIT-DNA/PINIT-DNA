import express from 'express';
import { randomUUID } from 'crypto';
import db from '../database.js';
import {
  getListing,
  tierPrice,
  applyCouponPercent,
  resolveCouponPercent,
  toPaise,
} from '../lib/pricing.js';
import { sealListingSale } from '../lib/seal-order.js';
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
  getBillingPublicConfig,
  isPaymentMockMode,
} from '../razorpay.js';
import { isListingPurchasable, LICENSE_STATUS, ORDER_STATUS, BRIDGE_EVENT } from '../lib/lifecycle.js';
import { authorizeLicenseDownload } from '../lib/license-auth.js';
import { recordBridgeEvent, markBridgeEventProcessed, retryDueBridgeEvents } from '../lib/bridge-events.js';
import { getSql, runSql } from '../lib/db.js';
import { requireBuyer, findUserByPinitId } from '../lib/rbac.js';
import { canPurchase, sellerDeniedPurchase } from '../lib/roles.js';

const router = express.Router();

/** GET /api/orders/billing/config */
router.get('/billing/config', (_req, res) => {
  res.json(getBillingPublicConfig());
});

/**
 * POST /api/orders/create-payment
 * Creates a payment intent + Razorpay (or mock) order. Does NOT seal yet.
 */
router.post('/create-payment', requireBuyer, async (req, res) => {
  try {
    const {
      listing_id,
      license_tier,
      buyer_name,
      buyer_email,
      buyer_org,
      buyer_pinit_id,
      coupon_code,
      buyer_key,
    } = req.body || {};

  if (!listing_id || !license_tier || !buyer_name || !buyer_email) {
      return res.status(400).json({
        error: 'Missing required fields: listing_id, license_tier, buyer_name, buyer_email',
      });
    }

    const listing = await getListing(listing_id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (!isListingPurchasable(listing.status)) {
      return res.status(409).json({ error: `Listing is not purchasable (status: ${listing.status})` });
    }
    const lock = await getSql('SELECT * FROM asset_commerce_locks WHERE asset_id = ?', [listing.asset_id]);
    if (lock) {
      return res.status(409).json({ error: 'Asset is exclusively licensed and locked from further sales' });
    }

    const couponPercent = await resolveCouponPercent(coupon_code, listing.pinit_id);
    const pricePaid = applyCouponPercent(tierPrice(listing, license_tier), couponPercent);
    const amountPaise = toPaise(pricePaid);
    const intentId = `PI-${randomUUID().slice(0, 8).toUpperCase()}`;

    const rz = await createRazorpayOrder({
      amountPaise,
      receipt: intentId,
      notes: {
        intentId,
        listing_id,
        license_tier,
        product: 'pinit_exchange_license',
      },
    });

    await runSql(
      `INSERT INTO payment_intents (
        id, kind, buyer_key, buyer_name, buyer_email, buyer_org, buyer_pinit_id,
        listing_id, license_tier, coupon_code, amount_paise, currency,
        razorpay_order_id, status
      ) VALUES (?, 'single', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'pending')`,
      [
        intentId,
        buyer_key || buyer_pinit_id || buyer_email,
        buyer_name,
        buyer_email,
        buyer_org || '',
        buyer_pinit_id || '',
        listing_id,
        license_tier,
        String(coupon_code || '').trim().toUpperCase() || null,
        amountPaise,
        rz.orderId,
      ],
    );

    res.status(201).json({
      payment_intent_id: intentId,
      orderId: rz.orderId,
      amount: rz.amount,
      amount_display: pricePaid,
      currency: rz.currency,
      keyId: rz.keyId,
      mock: rz.mock,
      listing_title: listing.title,
      license_tier,
      coupon_percent: couponPercent,
    });
  } catch (err) {
    console.error('[create-payment]', err);
    res.status(500).json({ error: err.message || 'Payment create failed' });
  }
});

/**
 * POST /api/orders/verify-payment
 * Verifies Razorpay signature (or mock) then seals the license.
 */
router.post('/verify-payment', async (req, res) => {
  try {
    const {
      payment_intent_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    if (!payment_intent_id) {
      return res.status(400).json({ error: 'payment_intent_id required' });
    }

    const intent = await getSql('SELECT * FROM payment_intents WHERE id = ?', [payment_intent_id]);
    if (!intent) return res.status(404).json({ error: 'Payment intent not found' });
    if (intent.status === 'paid') {
      return res.status(400).json({ error: 'Payment already completed' });
    }
    if (intent.buyer_pinit_id) {
      const payer = await findUserByPinitId(intent.buyer_pinit_id);
      if (payer && !canPurchase(payer.role)) {
        return res.status(403).json(sellerDeniedPurchase());
      }
    }

    const orderId = razorpay_order_id || intent.razorpay_order_id;
    let paymentId = razorpay_payment_id;
    let signature = razorpay_signature;

    if (isPaymentMockMode()) {
      paymentId = paymentId || `pay_mock_${Date.now()}`;
      signature = signature || 'mock';
    }

    if (!orderId || !paymentId) {
      return res.status(400).json({ error: 'Missing Razorpay payment fields' });
    }

    const ok = verifyRazorpaySignature({
      orderId,
      paymentId,
      signature: signature || '',
    });
    if (!ok) return res.status(400).json({ error: 'Invalid payment signature' });

    if (intent.kind === 'cart') {
      const lines = JSON.parse(intent.cart_snapshot || '[]');
      const results = [];
      for (const line of lines) {
        const listing = await getListing(line.listing_id);
        if (!listing) {
          results.push({ listing_id: line.listing_id, ok: false, error: 'Listing not found' });
          continue;
        }
        const couponPercent = await resolveCouponPercent(intent.coupon_code, listing.pinit_id);
        try {
          const order = await sealListingSale({
            listing,
            licenseTier: line.license_tier || 'commercial',
            buyerName: intent.buyer_name,
            buyerEmail: intent.buyer_email,
            buyerOrg: intent.buyer_org,
            buyerPinitId: intent.buyer_pinit_id,
            couponPercent,
            payment: {
              paymentStatus: isPaymentMockMode() ? 'mock_paid' : 'paid',
              razorpayOrderId: orderId,
              razorpayPaymentId: paymentId,
              paymentIntentId: intent.id,
            },
          });
          results.push({ listing_id: line.listing_id, ok: true, order });
        } catch (e) {
          results.push({ listing_id: line.listing_id, ok: false, error: e.message });
        }
      }

      await runSql(
        `UPDATE payment_intents SET status = 'paid', razorpay_payment_id = ? WHERE id = ?`,
        [paymentId, intent.id],
      );
      if (intent.buyer_key) {
        await runSql('DELETE FROM cart_items WHERE buyer_key = ?', [intent.buyer_key]);
      }

      return res.status(201).json({
        message: 'Cart payment verified and licenses sealed',
        mock: isPaymentMockMode(),
        results,
        sealed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        order: results.find((r) => r.ok)?.order || null,
      });
    }

    // single listing
    const listing = await getListing(intent.listing_id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    const couponPercent = await resolveCouponPercent(intent.coupon_code, listing.pinit_id);

    const order = await sealListingSale({
      listing,
      licenseTier: intent.license_tier,
      buyerName: intent.buyer_name,
      buyerEmail: intent.buyer_email,
      buyerOrg: intent.buyer_org,
      buyerPinitId: intent.buyer_pinit_id,
      couponPercent,
      payment: {
        paymentStatus: isPaymentMockMode() ? 'mock_paid' : 'paid',
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        paymentIntentId: intent.id,
      },
    });

    await runSql(
      `UPDATE payment_intents SET status = 'paid', razorpay_payment_id = ? WHERE id = ?`,
      [paymentId, intent.id],
    );

      res.status(201).json({
      message: 'Payment verified — license sealed',
      mock: isPaymentMockMode(),
      order,
    });
  } catch (err) {
    console.error('[verify-payment]', err);
    res.status(500).json({ error: err.message || 'Payment verify failed' });
  }
});

/**
 * Legacy checkout — creates payment then auto-verifies in mock mode.
 * With live Razorpay keys, returns payment_required so UI opens Checkout.js.
 */
router.post('/checkout', requireBuyer, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.listing_id || !body.license_tier || !body.buyer_name || !body.buyer_email) {
      return res.status(400).json({
        error: 'Missing required fields: listing_id, license_tier, buyer_name, buyer_email',
      });
    }

    // Reuse create-payment logic via internal call pattern
    const listing = await getListing(body.listing_id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const couponPercent = await resolveCouponPercent(body.coupon_code, listing.pinit_id);
    const pricePaid = applyCouponPercent(tierPrice(listing, body.license_tier), couponPercent);
    const amountPaise = toPaise(pricePaid);
    const intentId = `PI-${randomUUID().slice(0, 8).toUpperCase()}`;

    const rz = await createRazorpayOrder({
      amountPaise,
      receipt: intentId,
      notes: { intentId, listing_id: body.listing_id, product: 'pinit_exchange_license' },
    });

    await runSql(
      `INSERT INTO payment_intents (
        id, kind, buyer_key, buyer_name, buyer_email, buyer_org, buyer_pinit_id,
        listing_id, license_tier, coupon_code, amount_paise, currency,
        razorpay_order_id, status
      ) VALUES (?, 'single', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'pending')`,
      [
        intentId,
        body.buyer_pinit_id || body.buyer_email,
        body.buyer_name,
        body.buyer_email,
        body.buyer_org || '',
        body.buyer_pinit_id || '',
        body.listing_id,
        body.license_tier,
        String(body.coupon_code || '').trim().toUpperCase() || null,
        amountPaise,
        rz.orderId,
      ],
    );

    if (!isPaymentMockMode()) {
      return res.status(402).json({
        error: 'payment_required',
        payment_intent_id: intentId,
        orderId: rz.orderId,
        amount: rz.amount,
        currency: rz.currency,
        keyId: rz.keyId,
        mock: false,
      });
    }

    // Mock: verify immediately
    const paymentId = `pay_mock_${Date.now()}`;
    const order = await sealListingSale({
      listing,
      licenseTier: body.license_tier,
      buyerName: body.buyer_name,
      buyerEmail: body.buyer_email,
      buyerOrg: body.buyer_org,
      buyerPinitId: body.buyer_pinit_id,
      couponPercent,
      payment: {
        paymentStatus: 'mock_paid',
        razorpayOrderId: rz.orderId,
        razorpayPaymentId: paymentId,
        paymentIntentId: intentId,
      },
    });
    await runSql(`UPDATE payment_intents SET status = 'paid', razorpay_payment_id = ? WHERE id = ?`, [
      paymentId,
      intentId,
    ]);

    res.status(201).json({
      message: 'Sale sealed successfully in provenance ledger (mock payment)',
      mock: true,
      order,
    });
  } catch (err) {
    console.error('[checkout]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/my-licenses', (req, res) => {
  const email = String(req.query.email || '').trim();
  const pinitId = String(req.query.pinit_id || '').trim();
  if (!email && !pinitId) {
    return res.status(400).json({ error: 'email or pinit_id required' });
  }

  let sql = `
    SELECT o.*, l.title as asset_title, l.badge_tier, l.tagline
    FROM orders_sealed o
    LEFT JOIN listings l ON o.listing_id = l.listing_id
    WHERE 1=1
  `;
  const params = [];
  if (email) {
    sql += ' AND lower(o.buyer_email) = lower(?)';
    params.push(email);
  }
  if (pinitId) {
    sql += ' AND o.buyer_pinit_id = ?';
    params.push(pinitId);
  }
  sql += ' ORDER BY o.sealed_at DESC LIMIT 100';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ licenses: rows || [] });
  });
});

router.get('/certificate/:seal_id', async (req, res) => {
  try {
    const sealId = req.params.seal_id;
    const buyerPinitId = String(req.query.pinit_id || '').trim();
    const buyerEmail = String(req.query.email || '').trim();
    const order = await authorizeLicenseDownload({
      sealId,
      buyerPinitId,
      buyerEmail,
    });

    const enriched = await getSql(
      `SELECT o.*, l.title as asset_title, l.badge_tier, COALESCE(u.name, 'Creator') as seller_name
       FROM orders_sealed o
       JOIN listings l ON o.listing_id = l.listing_id
       LEFT JOIN users u ON o.seller_pinit_id = u.pinit_id
       WHERE o.seal_id = ?`,
      [sealId],
    );

    res.json({
      certificate_type: 'Pinit Provenance License Seal',
      seal_id: order.seal_id,
      order_id: order.order_id,
      asset_title: enriched?.asset_title,
      license_tier: String(order.license_tier || '').toUpperCase(),
      license_status: order.license_status || LICENSE_STATUS.ACTIVE,
      download_url: null, // use /download authorize — never leak raw token via certificate alone
      payment_status: order.payment_status || null,
      seller: {
        name: enriched?.seller_name,
        pinit_id: order.seller_pinit_id,
        exchange_id: order.seller_exchange_id,
      },
      buyer: {
        name: order.buyer_name,
        email: order.buyer_email,
        org: order.buyer_org,
      },
      price_paid: order.price_paid,
      dna_hash_summary: order.dna_hash_summary,
      note: 'Master file remains in Pinit HUB vault. Use POST /api/orders/download/authorize for delivery.',
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/orders/download/authorize
 * Verify buyer owns ACTIVE license before returning Hub delivery URL.
 */
router.post('/download/authorize', async (req, res) => {
  try {
    const sealId = String(req.body?.seal_id || req.body?.license_id || '').trim();
    const buyerPinitId = String(req.body?.buyer_pinit_id || req.body?.pinit_id || '').trim();
    const buyerEmail = String(req.body?.buyer_email || req.body?.email || '').trim();
    const requestedAssetId = String(req.body?.asset_id || '').trim();

    const order = await authorizeLicenseDownload({
      sealId,
      buyerPinitId,
      buyerEmail,
      requestedAssetId,
    });

    if (!order.delivery_url) {
      return res.status(409).json({
        error: 'Delivery not ready',
        message: 'Hub delivery token not prepared yet. Retry shortly.',
      });
    }

    res.json({
      ok: true,
      seal_id: order.seal_id,
      asset_id: order.asset_id,
      license_status: order.license_status || LICENSE_STATUS.ACTIVE,
      delivery_status: order.delivery_status || 'active',
      delivery_expires_at: order.delivery_expires_at,
      download_url: order.delivery_url,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/orders/:sealId/refund — mark order/license refunded; block delivery (no Razorpay payout yet)
 */
router.post('/:sealId/refund', async (req, res) => {
  try {
    const sealId = req.params.sealId;
    const actor = String(req.body?.actor_pinit_id || req.body?.pinit_id || '').trim();
    const reason = String(req.body?.reason || 'buyer_refund').trim();
    const order = await getSql('SELECT * FROM orders_sealed WHERE seal_id = ?', [sealId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Seller or buyer may initiate refund stub
    const allowed =
      (actor && (actor === order.seller_pinit_id || actor === order.buyer_pinit_id)) ||
      String(req.body?.admin || '') === '1';
    if (!allowed) return res.status(403).json({ error: 'Forbidden: only buyer, seller, or admin can refund' });

    if (String(order.status).toLowerCase() === ORDER_STATUS.REFUNDED) {
      return res.json({ message: 'Already refunded', order });
    }

    const refundId = `REF-${sealId}`;
    await runSql(
      `INSERT OR IGNORE INTO refunds (id, order_id, seal_id, amount, reason, status)
       VALUES (?, ?, ?, ?, ?, 'completed')`,
      [refundId, order.order_id, sealId, order.price_paid, reason],
    );
    await runSql(
      `UPDATE orders_sealed
       SET status = ?, license_status = ?, delivery_status = 'revoked', payment_status = 'refunded'
       WHERE seal_id = ?`,
      [ORDER_STATUS.REFUNDED, LICENSE_STATUS.REFUNDED, sealId],
    );
    await runSql(
      `UPDATE seller_earnings SET status = 'reversed' WHERE seal_id = ?`,
      [sealId],
    );

    const { event, duplicate } = await recordBridgeEvent({
      eventType: BRIDGE_EVENT.REFUND,
      idempotencyKey: `REFUND:${sealId}`,
      assetId: order.asset_id,
      listingId: order.listing_id,
      orderId: order.order_id,
      licenseId: sealId,
      payload: { reason },
    });
    if (!duplicate && event?.id) await markBridgeEventProcessed(event.id);

    const updated = await getSql('SELECT * FROM orders_sealed WHERE seal_id = ?', [sealId]);
    res.json({
      message: 'Order refunded — license and delivery blocked',
      order: updated,
      refund_id: refundId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/orders/bridge-events/retry — bounded retry stub */
router.post('/bridge-events/retry', async (_req, res) => {
  try {
    const results = await retryDueBridgeEvents({
      handler: async () => {
        /* stub: no-op reprocess; real Hub calls can be plugged later */
      },
    });
    res.json({ message: 'Retry pass complete', results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
