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
import {
  createRazorpayOrder,
  createRazorpayPaymentLink,
  exchangePublicOrigin,
  isPaymentMockMode,
} from '../razorpay.js';
import { forbidSellerCommerce, requireBuyer, requireSeller, requireVerifiedIdentity, pinitIdFromReq } from '../lib/rbac.js';
import { exchangePreviewUrl, PLACEHOLDER_PREVIEW } from '../lib/preview-url.js';
import { createLicensedShareOnHub, recordLicensedShareCopiedOnHub } from '../hub-client.js';
import { persistLicensedShare } from '../lib/licensed-access.js';
import { publicLicensedShareUrl } from '../lib/share-viewer-url.js';
import { emitForListing, emitForSeal } from '../lib/asset-activity.js';
import { identityMatchSql } from '../lib/pinit-identity.js';

const router = express.Router();

function buyerKey(req) {
  return String(req.query.buyer_key || req.body?.buyer_key || req.headers['x-buyer-key'] || '').trim();
}

/** Guest keys match exactly. Pinit IDs match every prefix of the same face. */
function ownerClause(column, key) {
  const k = String(key || '').trim();
  if (!k) return null;
  if (/^PINIT-/i.test(k)) return identityMatchSql(column, k);
  return { sql: `${column} = ?`, params: [k] };
}

/**
 * Cart/wishlist rows need the same preview the marketplace shows. `listings` has
 * no preview_url column — it lives in hub_assets — so join it and derive the URL
 * exactly as routes/listings.js does, otherwise the UI falls back to a stock
 * placeholder that shows the wrong picture.
 */
function enrichListings(listingIds, cb) {
  if (!listingIds.length) return cb(null, []);
  const placeholders = listingIds.map(() => '?').join(',');
  db.all(
    `SELECT l.*,
            COALESCE(u.name, 'Creator') as creator_name,
            COALESCE(ha.preview_url, '') as cached_preview_url
     FROM listings l
     LEFT JOIN users u ON l.pinit_id = u.pinit_id
     LEFT JOIN hub_assets ha ON l.asset_id = ha.asset_id
     WHERE l.listing_id IN (${placeholders})`,
    listingIds,
    (err, rows) => {
      if (err) return cb(err);
      const enriched = (rows || []).map((row) => {
        const out = {
          ...row,
          preview_url: exchangePreviewUrl(row.asset_id, row.cached_preview_url || PLACEHOLDER_PREVIEW),
        };
        delete out.cached_preview_url;
        return out;
      });
      cb(null, enriched);
    },
  );
}

/** GET /api/commerce/cart?buyer_key= */
router.get('/cart', (req, res) => {
  const key = buyerKey(req);
  const scope = ownerClause('buyer_key', key);
  if (!scope) return res.status(400).json({ error: 'buyer_key required' });

  db.all(`SELECT * FROM cart_items WHERE ${scope.sql} ORDER BY created_at DESC`, scope.params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const ids = (rows || []).map((r) => r.listing_id);
    enrichListings(ids, (e2, listings) => {
      if (e2) return res.status(500).json({ error: e2.message });
      const map = Object.fromEntries((listings || []).map((l) => [l.listing_id, l]));
      const items = (rows || []).map((r) => ({
        ...r,
        listing: map[r.listing_id] || null,
        line_price: map[r.listing_id]
          ? (map[r.listing_id][`price_${r.license_tier}`] || map[r.listing_id].price_commercial)
          : 0,
      })).filter((i) => i.listing);
      const subtotal = items.reduce((s, i) => s + Number(i.line_price || 0), 0);
      res.json({ items, subtotal, count: items.length });
    });
  });
});

/** POST /api/commerce/cart  { buyer_key, listing_id, license_tier } */
router.post('/cart', forbidSellerCommerce, (req, res) => {
  const key = String(req.body?.buyer_key || '').trim();
  const listingId = String(req.body?.listing_id || '').trim();
  const tier = String(req.body?.license_tier || 'commercial').trim();
  if (!key || !listingId) return res.status(400).json({ error: 'buyer_key and listing_id required' });

  const licenseScope = ownerClause('buyer_pinit_id', key);
  const rejectIfLicensed = (next) => {
    if (!licenseScope || !/^PINIT-/i.test(key)) return next();
    db.get(
      `SELECT seal_id FROM orders_sealed
        WHERE listing_id = ? AND ${licenseScope.sql}
          AND LOWER(COALESCE(license_status, 'active')) = 'active'
        LIMIT 1`,
      [listingId, ...licenseScope.params],
      (licErr, licensed) => {
        if (licErr) return res.status(500).json({ error: licErr.message });
        if (licensed) {
          return res.status(409).json({
            error: 'already_licensed',
            message: 'You already have an active licence for this asset. Open Purchases to access it.',
          });
        }
        next();
      },
    );
  };

  rejectIfLicensed(() => {
  db.run(
    `INSERT INTO cart_items (buyer_key, listing_id, license_tier, asset_id)
     VALUES (?, ?, ?, (SELECT asset_id FROM listings WHERE listing_id = ?))
     ON CONFLICT(buyer_key, listing_id, license_tier) DO UPDATE SET license_tier = excluded.license_tier`,
    [key, listingId, tier, listingId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ ok: true, id: this.lastID });
      emitForListing(db, listingId, {
        eventType: 'CART_ADDED',
        title: 'Added to cart',
        detail: `Listing ${listingId}`,
        payload: { listingId, licenseTier: tier },
      });
    },
  );
  });
});

/** DELETE /api/commerce/cart/:id?buyer_key= */
router.delete('/cart/:id', (req, res) => {
  const key = buyerKey(req);
  const scope = ownerClause('buyer_key', key);
  if (!scope) return res.status(400).json({ error: 'buyer_key required' });
  db.get(
    `SELECT listing_id FROM cart_items WHERE id = ? AND ${scope.sql}`,
    [req.params.id, ...scope.params],
    (_e, row) => {
    const listingId = row && row.listing_id;
    db.run(
      `DELETE FROM cart_items WHERE id = ? AND ${scope.sql}`,
      [req.params.id, ...scope.params],
      function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const removed = this.changes;
      res.json({ ok: true, removed });
      if (removed > 0 && listingId) {
        emitForListing(db, listingId, {
          eventType: 'CART_REMOVED',
          title: 'Removed from cart',
          detail: `Listing ${listingId}`,
          payload: { listingId },
        });
      }
    });
  });
});

/** POST /api/commerce/cart/create-payment — one Razorpay order for entire cart */
router.post('/cart/create-payment', requireBuyer, async (req, res) => {
  try {
    const key = String(req.body?.buyer_key || '').trim();
    const buyer_name = String(req.body?.buyer_name || '').trim();
    const buyer_email = String(req.body?.buyer_email || '').trim();
    const buyer_org = String(req.body?.buyer_org || '').trim();
    const buyer_pinit_id = String(req.body?.buyer_pinit_id || '').trim();
    const coupon_code = String(req.body?.coupon_code || '').trim().toUpperCase();

    if (!key || !buyer_name || !buyer_email) {
      return res.status(400).json({ error: 'buyer_key, buyer_name, buyer_email required' });
    }

    const cartScope = ownerClause('buyer_key', key);
    if (!cartScope) return res.status(400).json({ error: 'buyer_key required' });

    db.all(`SELECT * FROM cart_items WHERE ${cartScope.sql}`, cartScope.params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows?.length) return res.status(400).json({ error: 'Cart is empty' });

      try {
        let subtotal = 0;
        const lines = [];
        for (const row of rows) {
          const listing = await getListing(row.listing_id);
          if (!listing) continue;
          const pct = await resolveCouponPercent(coupon_code, listing.pinit_id);
          const linePrice = applyCouponPercent(tierPrice(listing, row.license_tier), pct);
          subtotal += linePrice;
          lines.push({
            listing_id: row.listing_id,
            license_tier: row.license_tier,
            line_price: linePrice,
          });
        }
        if (!lines.length) return res.status(400).json({ error: 'No valid cart lines' });

        const amountPaise = toPaise(subtotal);
        const intentId = `PI-${randomUUID().slice(0, 8).toUpperCase()}`;
        const rz = await createRazorpayOrder({
          amountPaise,
          receipt: intentId,
          notes: { intentId, kind: 'cart', product: 'pinit_exchange_cart' },
        });

        db.run(
          `INSERT INTO payment_intents (
            id, kind, buyer_key, buyer_name, buyer_email, buyer_org, buyer_pinit_id,
            cart_snapshot, coupon_code, amount_paise, currency, razorpay_order_id, status
          ) VALUES (?, 'cart', ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'pending')`,
          [
            intentId,
            key,
            buyer_name,
            buyer_email,
            buyer_org,
            buyer_pinit_id,
            JSON.stringify(lines),
            coupon_code || null,
            amountPaise,
            rz.orderId,
          ],
          async (insErr) => {
            if (insErr) return res.status(500).json({ error: insErr.message });
            let checkoutUrl = null;
            const origin = exchangePublicOrigin(req);
            if (!rz.mock && origin) {
              const link = await createRazorpayPaymentLink({
                amountPaise,
                currency: rz.currency,
                description: `Pinit Exchange cart (${lines.length} licenses)`.slice(0, 255),
                referenceId: intentId,
                callbackUrl: `${origin}/exchange/checkout/return`,
                notes: { intentId, kind: 'cart', product: 'pinit_exchange_cart' },
                customer: { name: buyer_name, email: buyer_email },
              });
              if (link?.shortUrl) checkoutUrl = link.shortUrl;
            }
            res.status(201).json({
              payment_intent_id: intentId,
              orderId: rz.orderId,
              amount: rz.amount,
              amount_display: subtotal,
              currency: rz.currency,
              keyId: rz.keyId,
              mock: rz.mock,
              checkoutUrl,
              lines,
            });
          },
        );
      } catch (e) {
        const status = Number(e.status) === 502 ? 502 : 500;
        res.status(status).json({
          error: status === 502 ? 'PAYMENT_UNAVAILABLE' : e.message,
          message: e.message,
        });
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/commerce/cart/checkout — prefer create-payment; mock auto-seals via verify */
router.post('/cart/checkout', requireBuyer, async (req, res) => {
  const key = String(req.body?.buyer_key || '').trim();
  const buyer_name = String(req.body?.buyer_name || '').trim();
  const buyer_email = String(req.body?.buyer_email || '').trim();
  const buyer_org = String(req.body?.buyer_org || '').trim();
  const buyer_pinit_id = String(req.body?.buyer_pinit_id || '').trim();
  const coupon_code = String(req.body?.coupon_code || '').trim().toUpperCase();

  if (!key || !buyer_name || !buyer_email) {
    return res.status(400).json({ error: 'buyer_key, buyer_name, buyer_email required' });
  }

  // Delegate to create-payment then verify in mock mode
  try {
    const authHeaders = {
      'Content-Type': 'application/json',
    };
    if (req.headers.authorization) authHeaders.Authorization = req.headers.authorization;
    if (req.headers['x-session-token']) authHeaders['X-Session-Token'] = req.headers['x-session-token'];
    if (req.headers['x-pinit-id']) authHeaders['X-Pinit-Id'] = req.headers['x-pinit-id'];

    const createRes = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api/commerce/cart/create-payment`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        buyer_key: key,
        buyer_name,
        buyer_email,
        buyer_org,
        buyer_pinit_id,
        coupon_code,
      }),
    });
    const created = await createRes.json();
    if (!createRes.ok) return res.status(createRes.status).json(created);

    const { isPaymentMockMode } = await import('../razorpay.js');
    if (!isPaymentMockMode()) {
      return res.status(402).json({
        error: 'payment_required',
        ...created,
      });
    }

    const verifyRes = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api/orders/verify-payment`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        payment_intent_id: created.payment_intent_id,
        razorpay_order_id: created.orderId,
        razorpay_payment_id: `pay_mock_${Date.now()}`,
        razorpay_signature: 'mock',
      }),
    });
    const verified = await verifyRes.json();
    return res.status(verifyRes.status).json(verified);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** Wishlist */
router.get('/wishlist', (req, res) => {
  const key = buyerKey(req);
  const scope = ownerClause('buyer_key', key);
  if (!scope) return res.status(400).json({ error: 'buyer_key required' });
  db.all(`SELECT * FROM wishlist WHERE ${scope.sql} ORDER BY created_at DESC`, scope.params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const ids = (rows || []).map((r) => r.listing_id);
    enrichListings(ids, (e2, listings) => {
      if (e2) return res.status(500).json({ error: e2.message });
      const map = Object.fromEntries((listings || []).map((l) => [l.listing_id, l]));
      const items = (rows || []).map((r) => ({ ...r, listing: map[r.listing_id] || null })).filter((i) => i.listing);
      res.json({ items, count: items.length });
    });
  });
});

router.post('/wishlist', (req, res) => {
  const key = String(req.body?.buyer_key || '').trim();
  const listingId = String(req.body?.listing_id || '').trim();
  if (!key || !listingId) return res.status(400).json({ error: 'buyer_key and listing_id required' });
  db.run(
    `INSERT OR IGNORE INTO wishlist (buyer_key, listing_id, asset_id)
     VALUES (?, ?, (SELECT asset_id FROM listings WHERE listing_id = ?))`,
    [key, listingId, listingId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const added = this.changes;
      db.run('UPDATE listings SET saves = COALESCE(saves, 0) + 1 WHERE listing_id = ?', [listingId]);
      res.status(201).json({ ok: true });
      // Only emit when a row was actually inserted — a repeat save is not a
      // new activity event.
      if (added > 0) {
        emitForListing(db, listingId, {
          eventType: 'WISHLIST_ADDED',
          title: 'Saved to wishlist',
          detail: `Listing ${listingId}`,
          payload: { listingId },
        });
      }
    },
  );
});

router.delete('/wishlist/:listingId', (req, res) => {
  const key = buyerKey(req);
  const scope = ownerClause('buyer_key', key);
  if (!scope) return res.status(400).json({ error: 'buyer_key required' });
  const listingId = req.params.listingId;
  db.run(
    `DELETE FROM wishlist WHERE ${scope.sql} AND listing_id = ?`,
    [...scope.params, listingId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const removed = this.changes;
      res.json({ ok: true, removed });
      if (removed > 0) {
        emitForListing(db, listingId, {
          eventType: 'WISHLIST_REMOVED',
          title: 'Removed from wishlist',
          detail: `Listing ${listingId}`,
          payload: { listingId },
        });
      }
    },
  );
});

/** Move guest cart/wishlist onto the signed-in Pinit identity. Never deletes rows. */
router.post('/claim-guest', requireVerifiedIdentity, (req, res) => {
  const guest = String(req.body?.guest_key || '').trim();
  const dest = String(req.verifiedPinitId || '').trim();
  if (!guest || !/^GUEST-/i.test(guest) || !dest) {
    return res.status(400).json({ error: 'guest_key required' });
  }
  db.run('UPDATE cart_items SET buyer_key = ? WHERE buyer_key = ?', [dest, guest], (e1) => {
    if (e1) return res.status(500).json({ error: e1.message });
    db.run('UPDATE wishlist SET buyer_key = ? WHERE buyer_key = ?', [dest, guest], (e2) => {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json({ ok: true });
    });
  });
});

/** Reviews for a seller's listings (must be before /reviews/:listingId) */
router.get('/reviews/seller', requireSeller, (req, res) => {
  const pinitId = String(req.query.pinit_id || req.query.seller_pinit_id || '').trim();
  if (!pinitId) return res.status(400).json({ error: 'pinit_id required' });
  db.all(
    `SELECT r.*, l.title AS listing_title, l.asset_id, l.preview_url
     FROM reviews r
     INNER JOIN listings l ON l.listing_id = r.listing_id
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(UPPER(l.pinit_id), 'PINIT-EX-', ''), 'PINIT-USER-', ''), 'PINIT-ORG-', ''), 'PINIT-', '')
       = REPLACE(REPLACE(REPLACE(REPLACE(UPPER(?), 'PINIT-EX-', ''), 'PINIT-USER-', ''), 'PINIT-ORG-', ''), 'PINIT-', '')
     ORDER BY r.created_at DESC
     LIMIT 100`,
    [pinitId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const reviews = rows || [];
      const avg = reviews.length
        ? reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length
        : 0;
      res.json({
        reviews,
        average: Math.round(avg * 10) / 10,
        count: reviews.length,
      });
    },
  );
});

router.get('/reviews/mine', (req, res) => {
  const pinitId = String(req.query.pinit_id || req.query.buyer_pinit_id || '').trim();
  if (!pinitId) return res.status(400).json({ error: 'pinit_id required' });
  db.all(
    `SELECT r.*, l.title AS listing_title
     FROM reviews r
     LEFT JOIN listings l ON l.listing_id = r.listing_id
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(UPPER(COALESCE(r.buyer_pinit_id,'')), 'PINIT-EX-', ''), 'PINIT-USER-', ''), 'PINIT-ORG-', ''), 'PINIT-', '')
       = REPLACE(REPLACE(REPLACE(REPLACE(UPPER(?), 'PINIT-EX-', ''), 'PINIT-USER-', ''), 'PINIT-ORG-', ''), 'PINIT-', '')
     ORDER BY r.created_at DESC
     LIMIT 50`,
    [pinitId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ reviews: rows || [] });
    },
  );
});

/** Reviews */
router.get('/reviews/:listingId', (req, res) => {
  db.all(
    'SELECT * FROM reviews WHERE listing_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.params.listingId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const avg = rows?.length
        ? rows.reduce((s, r) => s + Number(r.rating), 0) / rows.length
        : 0;
      res.json({ reviews: rows || [], average: Math.round(avg * 10) / 10, count: rows?.length || 0 });
    },
  );
});

router.post('/reviews', (req, res) => {
  const listingId = String(req.body?.listing_id || '').trim();
  const buyerName = String(req.body?.buyer_name || 'Buyer').trim();
  const rating = Math.min(5, Math.max(1, Number(req.body?.rating) || 5));
  const comment = String(req.body?.comment || '').trim();
  const buyerPinitId = String(req.body?.buyer_pinit_id || '').trim();
  if (!listingId) return res.status(400).json({ error: 'listing_id required' });

  db.run(
    `INSERT INTO reviews (listing_id, buyer_pinit_id, buyer_name, rating, comment, asset_id)
     VALUES (?, ?, ?, ?, ?, (SELECT asset_id FROM listings WHERE listing_id = ?))`,
    [listingId, buyerPinitId || null, buyerName, rating, comment, listingId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ ok: true, id: this.lastID });
      // Rating and the buyer's Pinit ID are business data the creator may see.
      // buyer_name and the comment body are not sent — Hub scrubs names anyway.
      emitForListing(db, listingId, {
        eventType: 'REVIEWED',
        title: `Reviewed ${rating}/5`,
        detail: `Listing ${listingId}`,
        payload: { listingId, rating, buyerPinitId: buyerPinitId || null },
      });
    },
  );
});

/** Coupons (seller-created; applied at checkout stub) */
router.get('/coupons', (req, res) => {
  const seller = String(req.query.seller_pinit_id || '').trim();
  if (!seller) return res.status(400).json({ error: 'seller_pinit_id required' });
  db.all(
    'SELECT * FROM coupons WHERE seller_pinit_id = ? ORDER BY created_at DESC',
    [seller],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ coupons: rows || [] });
    },
  );
});

router.post('/coupons', requireSeller, (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const seller = String(req.body?.seller_pinit_id || '').trim();
  const percent = Math.min(90, Math.max(1, Number(req.body?.percent_off) || 10));
  if (!code || !seller) return res.status(400).json({ error: 'code and seller_pinit_id required' });

  db.run(
    'INSERT OR REPLACE INTO coupons (code, seller_pinit_id, percent_off, active) VALUES (?, ?, ?, 1)',
    [code, seller, percent],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ ok: true, code, percent_off: percent });
    },
  );
});

router.post('/coupons/validate', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'code required' });
  db.get('SELECT * FROM coupons WHERE code = ? AND active = 1', [code], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Coupon not found or inactive' });
    res.json({ ok: true, code: row.code, percent_off: row.percent_off, seller_pinit_id: row.seller_pinit_id });
  });
});

/**
 * POST /api/commerce/purchases/:sealId/share
 *
 * Buyer shares a file they licensed. Exchange proves the caller owns the seal,
 * then Hub creates the ShareLink — Hub owns custody and all tracking, so no
 * share/tracking state is duplicated here.
 */
router.post('/purchases/:sealId/share', requireVerifiedIdentity, (req, res) => {
  const sealId = String(req.params.sealId || '').trim();
  // From the signed session, not the X-PinIT-Id header. The ownership check
  // below compares this against the seal's buyer — if the caller supplied both
  // sides, anyone could mint a Hub share link for a purchase that is not
  // theirs, which would hand out the licensed file.
  const callerPinitId = req.verifiedPinitId;
  if (!sealId) return res.status(400).json({ error: 'sealId required' });

  db.get('SELECT * FROM orders_sealed WHERE seal_id = ?', [sealId], async (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Purchase not found' });

    // Ownership: only the buyer on this seal may share it. Compared on the bare
    // Pinit code so PINIT-EX-x and PINIT-x forms of the same identity match.
    const code = (v) => String(v || '').trim().toUpperCase().split('-').pop();
    if (code(order.buyer_pinit_id) !== code(callerPinitId)) {
      return res.status(403).json({ error: 'This purchase does not belong to you' });
    }
    if (order.license_status && order.license_status !== 'active') {
      return res.status(403).json({ error: 'License is not active' });
    }

    try {
      const result = await createLicensedShareOnHub({
        assetId: order.asset_id,
        sealId: order.seal_id,
        orderId: order.order_id,
        buyerPinitId: order.buyer_pinit_id,
        licenseTier: order.license_tier,
        options: req.body?.options || {},
      });
      const shareUrl = publicLicensedShareUrl(result.token, process.env.HUB_APP_URL) || result.shareUrl;
      const payload = {
        token: result.token,
        shareUrl,
        expiresAt: result.expiresAt ?? null,
        allowDownload: result.allowDownload !== false,
        allowPrint: result.allowPrint !== false,
        maxViews: result.maxViews ?? req.body?.options?.maxViews ?? null,
      };
      try {
        await persistLicensedShare(order.seal_id, payload);
      } catch (persistErr) {
        console.error('[commerce/share] persist failed', persistErr?.message);
      }
      res.status(201).json({ ok: true, ...payload });
    } catch (e) {
      console.error('[commerce/share]', e.message);
      const status = e.status && Number(e.status) >= 400 ? Number(e.status) : 502;
      res.status(status).json({
        error: e.message || 'Couldn\'t create the sharing link.',
      });
    }
  });
});

router.post('/purchases/:sealId/share/copied', requireVerifiedIdentity, (req, res) => {
  const sealId = String(req.params.sealId || '').trim();
  const callerPinitId = req.verifiedPinitId;
  const token = String(req.body?.token || '').trim();
  if (!sealId || !token) return res.status(400).json({ error: 'sealId and token required' });

  db.get('SELECT * FROM orders_sealed WHERE seal_id = ?', [sealId], async (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Purchase not found' });
    const code = (v) => String(v || '').trim().toUpperCase().split('-').pop();
    if (code(order.buyer_pinit_id) !== code(callerPinitId)) {
      return res.status(403).json({ error: 'This purchase does not belong to you' });
    }
    const recorded = await recordLicensedShareCopiedOnHub(token);
    res.json({ ok: true, recorded: recorded.ok });
  });
});

export default router;

