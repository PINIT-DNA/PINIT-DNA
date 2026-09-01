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
import { getSql, runSql, allSql } from '../lib/db.js';
import { requireBuyer, findUserByPinitId, requireVerifiedIdentity } from '../lib/rbac.js';
import { canPurchase, sellerDeniedPurchase } from '../lib/roles.js';
import { postAssetActivity, emitForSeal } from '../lib/asset-activity.js';
import { downloadsRemaining, describeEntitlement, LICENSE_TERMS_VERSION } from '../lib/licensing.js';
import { formatMoney, activeCurrency } from '../lib/money.js';

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

    // Licence terms must be accepted before money is taken. Recorded on the
    // intent so the acceptance timestamp is the moment of purchase.
    const acceptedTerms = req.body?.accept_terms === true || req.body?.accept_terms === 'true';
    if (!acceptedTerms) {
      return res.status(400).json({
        error: 'Licence terms must be accepted before checkout',
        terms_version: LICENSE_TERMS_VERSION,
      });
    }

    await runSql(
      // A single-listing intent maps to exactly one asset, so asset_id is
      // deterministic here. Cart intents deliberately leave it NULL — one
      // payment can span several assets and must be resolved per order line.
      `INSERT INTO payment_intents (
        id, kind, buyer_key, buyer_name, buyer_email, buyer_org, buyer_pinit_id,
        listing_id, license_tier, coupon_code, amount_paise, currency,
        razorpay_order_id, status, asset_id, terms_accepted_at
      ) VALUES (?, 'single', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending',
                (SELECT asset_id FROM listings WHERE listing_id = ?), CURRENT_TIMESTAMP)`,
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
        rz.currency || activeCurrency(),
        rz.orderId,
        listing_id,
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
            termsAcceptedAt: intent.terms_accepted_at || null,
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
      termsAcceptedAt: intent.terms_accepted_at || null,
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
      termsAcceptedAt: (body.accept_terms === true || body.accept_terms === 'true')
        ? new Date().toISOString()
        : null,
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

/**
 * GET /api/orders/my-licenses — the caller's own licence entitlements.
 *
 * This route had no guard whatsoever and scoped itself by whatever `pinit_id`
 * or `email` arrived in the query string. Because Pinit IDs are shown publicly
 * on listings and reviews, anyone could read anyone else's licences — including
 * the buyer_email on each order. It is now scoped to the verified session only,
 * and the query parameters are ignored for scoping.
 */
router.get('/my-licenses', requireVerifiedIdentity, (req, res) => {
  const pinitId = req.verifiedPinitId;

  const sql = `
    SELECT o.*, l.title as asset_title, l.badge_tier, l.tagline
    FROM orders_sealed o
    LEFT JOIN listings l ON o.listing_id = l.listing_id
    WHERE o.buyer_pinit_id = ?
    ORDER BY o.sealed_at DESC LIMIT 100
  `;
  const params = [pinitId];

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ licenses: rows || [] });
  });
});

router.get('/certificate/:seal_id', requireVerifiedIdentity, async (req, res) => {
  try {
    const sealId = req.params.seal_id;
    // Identity comes from the signed session, never from the query string.
    // This route previously trusted ?pinit_id= / ?email=, which meant anyone
    // holding a seal id and a public Pinit ID could read the certificate —
    // and it carries the buyer's name, email and what they paid.
    const buyerPinitId = req.verifiedPinitId;
    const order = await authorizeLicenseDownload({
      sealId,
      buyerPinitId,
      buyerEmail: '',
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
router.post('/download/authorize', requireVerifiedIdentity, async (req, res) => {
  try {
    const sealId = String(req.body?.seal_id || req.body?.license_id || '').trim();
    // The buyer identity is taken from the signed session only.
    //
    // This route used to read buyer_pinit_id straight from the request body and
    // hand it to authorizeLicenseDownload, which compares it against the seal's
    // stored buyer. Because the two values came from the same untrusted place
    // they always matched: anyone who knew a seal id and a Pinit ID — both of
    // which appear publicly in the UI — could obtain the delivery URL for an
    // asset they never licensed. The ownership check is only meaningful when
    // one side of the comparison is proven.
    const buyerPinitId = req.verifiedPinitId;
    const requestedAssetId = String(req.body?.asset_id || '').trim();

    const order = await authorizeLicenseDownload({
      sealId,
      buyerPinitId,
      buyerEmail: '',
      requestedAssetId,
    });

    if (!order.delivery_url) {
      return res.status(409).json({
        error: 'Delivery not ready',
        message: 'Hub delivery token not prepared yet. Retry shortly.',
      });
    }

    // Authorisation passed, so this download counts against the tier
    // entitlement. Incremented before responding so a client that never
    // finishes the transfer cannot replay the allowance indefinitely.
    await runSql(
      'UPDATE orders_sealed SET download_count = COALESCE(download_count, 0) + 1 WHERE seal_id = ?',
      [order.seal_id],
    );
    const used = Number(order.download_count || 0) + 1;
    const remaining = downloadsRemaining({ ...order, download_count: used });

    res.json({
      ok: true,
      seal_id: order.seal_id,
      asset_id: order.asset_id,
      license_status: order.license_status || LICENSE_STATUS.ACTIVE,
      delivery_status: order.delivery_status || 'active',
      delivery_expires_at: order.delivery_expires_at,
      download_url: order.delivery_url,
      downloads_used: used,
      downloads_remaining: remaining,
      download_limit: order.download_limit ?? null,
    });

    // Authorised download of a licensed asset. buyer_email is intentionally not
    // forwarded — only the Pinit ID, which the creator is permitted to see.
    postAssetActivity({
      assetId: order.asset_id,
      eventType: 'DOWNLOADED',
      title: 'Licensed asset downloaded',
      detail: `Seal ${order.seal_id}`,
      payload: { sealId: order.seal_id, buyerPinitId: buyerPinitId || null },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/my-orders — buyer purchase history.
 *
 * Distinct from /my-licenses: this is the commercial record (what was paid,
 * in which currency, and its payment state), not the licence entitlement.
 * Scoped to the caller's own Pinit ID — never a client-supplied buyer id.
 */
router.get('/my-orders', requireVerifiedIdentity, requireBuyer, async (req, res) => {
  try {
    // Verified session only — a claimed Pinit ID must never select someone
    // else's purchase history.
    const buyerPinitId = req.verifiedPinitId;
    if (!buyerPinitId) return res.status(400).json({ error: 'buyer identity required' });

    const rows = await allSql(
      `SELECT o.seal_id, o.order_id, o.invoice_number, o.listing_id, o.asset_id,
              o.license_tier, o.price_paid, o.platform_fee, o.currency,
              o.status, o.payment_status, o.license_status, o.delivery_status,
              o.sealed_at, o.download_count, o.download_limit,
              o.terms_version, o.terms_accepted_at,
              l.title
         FROM orders_sealed o
         LEFT JOIN listings l ON l.listing_id = o.listing_id
        WHERE o.buyer_pinit_id = ?
        ORDER BY o.sealed_at DESC`,
      [buyerPinitId],
    );

    res.json(rows.map((o) => ({
      ...o,
      currency: o.currency || activeCurrency(),
      amount_display: formatMoney(o.price_paid, o.currency || activeCurrency()),
      entitlement: describeEntitlement(o.license_tier),
      downloads_remaining: downloadsRemaining(o),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/invoice/:sealId — invoice payload for one order.
 *
 * Returns only the buyer's own order. Amounts are formatted server-side in the
 * currency the order was actually charged in, so a historical INR order never
 * renders as USD after the platform currency changes.
 */
router.get('/invoice/:sealId', requireVerifiedIdentity, requireBuyer, async (req, res) => {
  try {
    const buyerPinitId = req.verifiedPinitId;
    const order = await getSql(
      `SELECT o.*, l.title
         FROM orders_sealed o
         LEFT JOIN listings l ON l.listing_id = o.listing_id
        WHERE o.seal_id = ?`,
      [req.params.sealId],
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!buyerPinitId || order.buyer_pinit_id !== buyerPinitId) {
      // Same response as missing, so invoices cannot be enumerated.
      return res.status(404).json({ error: 'Order not found' });
    }

    const cur = order.currency || activeCurrency();
    const gross = Number(order.price_paid || 0);
    const fee = Number(order.platform_fee || 0);

    res.json({
      invoice_number: order.invoice_number || `INV-${String(order.seal_id).replace('SEAL-', '')}`,
      issued_at: order.sealed_at,
      seal_id: order.seal_id,
      order_id: order.order_id,
      status: order.status,
      payment_status: order.payment_status,
      seller: { pinit_id: order.seller_pinit_id, exchange_id: order.seller_exchange_id },
      buyer: { pinit_id: order.buyer_pinit_id },
      item: {
        title: order.title || order.asset_id,
        asset_id: order.asset_id,
        listing_id: order.listing_id,
        license_tier: order.license_tier,
        entitlement: describeEntitlement(order.license_tier),
      },
      terms: {
        version: order.terms_version || LICENSE_TERMS_VERSION,
        accepted_at: order.terms_accepted_at || null,
      },
      currency: cur,
      totals: {
        gross,
        platform_fee: fee,
        total: gross,
        gross_display: formatMoney(gross, cur),
        platform_fee_display: formatMoney(fee, cur),
        total_display: formatMoney(gross, cur),
      },
      // No tax is computed. Stated explicitly so an invoice is never mistaken
      // for a tax document until GST handling is implemented.
      tax: { applied: false, note: 'Tax not applied. This document is not a tax invoice.' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/orders/:sealId/refund — mark order/license refunded; block delivery (no Razorpay payout yet)
 */
router.post('/:sealId/refund', requireVerifiedIdentity, async (req, res) => {
  try {
    const sealId = req.params.sealId;
    // Actor comes from the signed session. Previously this was read from the
    // request body and compared against the order's own parties — so the caller
    // supplied both sides of the check. Worse, `admin: "1"` in the body skipped
    // the comparison outright, letting any caller refund any order.
    const actor = req.verifiedPinitId;
    const reason = String(req.body?.reason || 'buyer_refund').trim();
    const order = await getSql('SELECT * FROM orders_sealed WHERE seal_id = ?', [sealId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Only the two real parties to this order. Compared on the bare Pinit code
    // so PINIT-EX-x and PINIT-x forms of one identity still match.
    const code = (v) => String(v || '').trim().toUpperCase().split('-').pop();
    const allowed =
      code(actor) === code(order.seller_pinit_id) || code(actor) === code(order.buyer_pinit_id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden: only the buyer or seller on this order can refund it' });

    if (String(order.status).toLowerCase() === ORDER_STATUS.REFUNDED) {
      return res.json({ message: 'Already refunded', order });
    }

    // Return the money before revoking anything. A refund that only flips
    // database state leaves the buyer without the asset AND without the funds.
    let gatewayRefund = null;
    if (order.razorpay_payment_id && !isPaymentMockMode()) {
      try {
        gatewayRefund = await refundRazorpayPayment(
          order.razorpay_payment_id,
          toPaise(order.price_paid, order.currency),
        );
      } catch (refundErr) {
        // Do not revoke the licence if the money could not be returned.
        return res.status(502).json({
          error: 'Refund failed at the payment provider',
          message: refundErr.message,
          hint: 'The licence has not been revoked. Retry, or refund manually in the Razorpay dashboard.',
        });
      }
    }

    const refundId = `REF-${sealId}`;
    await runSql(
      `INSERT OR IGNORE INTO refunds (id, order_id, seal_id, amount, reason, status, asset_id)
       VALUES (?, ?, ?, ?, ?, 'completed', ?)`,
      [refundId, order.order_id, sealId, order.price_paid, reason, order.asset_id || null],
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
      gateway_refund_id: gatewayRefund?.id || null,
      gateway_refunded: Boolean(gatewayRefund),
    });

    postAssetActivity({
      assetId: order.asset_id,
      eventType: 'REFUNDED',
      title: 'Order refunded',
      detail: `Seal ${sealId}`,
      payload: { sealId, orderId: order.order_id, reason, refundId },
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
