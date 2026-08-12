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
import { createRazorpayOrder, isPaymentMockMode } from '../razorpay.js';
import { forbidSellerCommerce, requireBuyer, requireSeller } from '../lib/rbac.js';

const router = express.Router();

function buyerKey(req) {
  return String(req.query.buyer_key || req.body?.buyer_key || req.headers['x-buyer-key'] || '').trim();
}

function enrichListings(listingIds, cb) {
  if (!listingIds.length) return cb(null, []);
  const placeholders = listingIds.map(() => '?').join(',');
  db.all(
    `SELECT l.*, COALESCE(u.name, 'Creator') as creator_name
     FROM listings l
     LEFT JOIN users u ON l.pinit_id = u.pinit_id
     WHERE l.listing_id IN (${placeholders})`,
    listingIds,
    cb,
  );
}

/** GET /api/commerce/cart?buyer_key= */
router.get('/cart', (req, res) => {
  const key = buyerKey(req);
  if (!key) return res.status(400).json({ error: 'buyer_key required' });

  db.all('SELECT * FROM cart_items WHERE buyer_key = ? ORDER BY created_at DESC', [key], (err, rows) => {
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

  db.run(
    `INSERT INTO cart_items (buyer_key, listing_id, license_tier)
     VALUES (?, ?, ?)
     ON CONFLICT(buyer_key, listing_id, license_tier) DO UPDATE SET license_tier = excluded.license_tier`,
    [key, listingId, tier],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ ok: true, id: this.lastID });
    },
  );
});

/** DELETE /api/commerce/cart/:id?buyer_key= */
router.delete('/cart/:id', (req, res) => {
  const key = buyerKey(req);
  if (!key) return res.status(400).json({ error: 'buyer_key required' });
  db.run('DELETE FROM cart_items WHERE id = ? AND buyer_key = ?', [req.params.id, key], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, removed: this.changes });
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

    db.all('SELECT * FROM cart_items WHERE buyer_key = ?', [key], async (err, rows) => {
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
          (insErr) => {
            if (insErr) return res.status(500).json({ error: insErr.message });
            res.status(201).json({
              payment_intent_id: intentId,
              orderId: rz.orderId,
              amount: rz.amount,
              amount_display: subtotal,
              currency: rz.currency,
              keyId: rz.keyId,
              mock: rz.mock,
              lines,
            });
          },
        );
      } catch (e) {
        res.status(500).json({ error: e.message });
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
    const createRes = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api/commerce/cart/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
  if (!key) return res.status(400).json({ error: 'buyer_key required' });
  db.all('SELECT * FROM wishlist WHERE buyer_key = ? ORDER BY created_at DESC', [key], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const ids = (rows || []).map((r) => r.listing_id);
    enrichListings(ids, (e2, listings) => {
      if (e2) return res.status(500).json({ error: e2.message });
      const map = Object.fromEntries((listings || []).map((l) => [l.listing_id, l]));
      res.json({
        items: (rows || []).map((r) => ({ ...r, listing: map[r.listing_id] || null })).filter((i) => i.listing),
      });
    });
  });
});

router.post('/wishlist', (req, res) => {
  const key = String(req.body?.buyer_key || '').trim();
  const listingId = String(req.body?.listing_id || '').trim();
  if (!key || !listingId) return res.status(400).json({ error: 'buyer_key and listing_id required' });
  db.run(
    'INSERT OR IGNORE INTO wishlist (buyer_key, listing_id) VALUES (?, ?)',
    [key, listingId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.run('UPDATE listings SET saves = COALESCE(saves, 0) + 1 WHERE listing_id = ?', [listingId]);
      res.status(201).json({ ok: true });
    },
  );
});

router.delete('/wishlist/:listingId', (req, res) => {
  const key = buyerKey(req);
  if (!key) return res.status(400).json({ error: 'buyer_key required' });
  db.run(
    'DELETE FROM wishlist WHERE buyer_key = ? AND listing_id = ?',
    [key, req.params.listingId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, removed: this.changes });
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
    `INSERT INTO reviews (listing_id, buyer_pinit_id, buyer_name, rating, comment)
     VALUES (?, ?, ?, ?, ?)`,
    [listingId, buyerPinitId || null, buyerName, rating, comment],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ ok: true, id: this.lastID });
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

export default router;
