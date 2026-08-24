import express from 'express';
import db from '../database.js';
import { requireSeller } from '../lib/rbac.js';
import { sellerMatchClause, listingUserJoinSql, extractPinitCode, toUserPinitId } from '../lib/pinit-identity.js';
import { exchangePreviewUrl } from '../lib/preview-url.js';
import { publicListingSql } from '../lib/lifecycle.js';
import { fetchHubProfiles } from '../hub-client.js';

/**
 * What a creator is allowed to see about a sale of their own work.
 *
 * The desk previously returned `SELECT * FROM orders_sealed` straight to the
 * client, which handed every creator their buyers' email, name and
 * organisation, the Razorpay payment ids, and — worst — the live
 * `delivery_token` for the buyer's copy. None of it was used by the UI.
 *
 * This is an allow-list rather than a deny-list on purpose: a column added to
 * orders_sealed later cannot leak by default, it has to be named here.
 *
 * Buyer identity is represented by the public Pinit ID only. That is what the
 * creator legitimately needs to reconcile a sale, and it is already public.
 */
const CREATOR_VISIBLE_SALE_FIELDS = [
  'seal_id',
  'order_id',
  'listing_id',
  'asset_id',
  'license_tier',
  'price_paid',
  'platform_fee',
  'creator_net',
  'currency',
  'status',
  'payment_status',
  'license_status',
  'delivery_status',
  'sealed_at',
  'download_count',
  'download_limit',
  'invoice_number',
  'buyer_pinit_id',
];

function creatorVisibleSale(row) {
  if (!row) return null;
  const out = {};
  for (const key of CREATOR_VISIBLE_SALE_FIELDS) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

function isPlaceholderName(name) {
  return !name || /^pinit(\s+|-)(user|creator|buyer)$/i.test(String(name).trim());
}

function applyHubProfile(base, hub) {
  const code = extractPinitCode(hub?.pinit_id || hub?.pinit_user_id || base.pinit_id);
  const hubName = String(hub?.name || '').trim();
  const localName = String(base.name || '').trim();
  return {
    ...base,
    name: !isPlaceholderName(hubName) ? hubName : (!isPlaceholderName(localName) ? localName : (hubName || localName || 'PINIT Creator')),
    bio: String(hub?.bio || '').trim() || base.bio || '',
    // user_id (raw Hub User.id) intentionally omitted — public payload.
    pinit_user_id: hub?.pinit_user_id || toUserPinitId(code || base.pinit_id),
    avatar_url: hub?.avatar_url || base.avatar_url || '',
  };
}

const router = express.Router();

function whereClause(match) {
  return `WHERE ${match.sql.replace(/^\s*AND\s+/i, '')}`;
}

function withPreview(item) {
  return {
    ...item,
    preview_url: exchangePreviewUrl(item.asset_id, item.preview_url),
  };
}

// Creator Desk Consolidated Metrics
router.get('/desk', requireSeller, (req, res) => {
  const pinitId = String(req.query.pinit_id || req.exchangeUser?.pinit_id || '').trim();
  if (!pinitId) {
    return res.status(400).json({ error: 'pinit_id is required' });
  }

  const user = req.exchangeUser;
  const listingScope = sellerMatchClause('pinit_id', pinitId);
  const salesScope = sellerMatchClause('seller_pinit_id', pinitId);

  db.all(
    `SELECT * FROM listings ${whereClause(listingScope)} ORDER BY created_at DESC`,
    listingScope.params,
    (err, listings) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all(
        `SELECT * FROM orders_sealed ${whereClause(salesScope)} ORDER BY sealed_at DESC`,
        salesScope.params,
        (err, sales) => {
          if (err) return res.status(500).json({ error: err.message });

          db.all(
            `SELECT * FROM tracking_jobs ${whereClause(salesScope)}`,
            salesScope.params,
            (err, trackingJobs) => {
              if (err) return res.status(500).json({ error: err.message });

              db.all("SELECT * FROM requirements WHERE status = 'open' ORDER BY budget DESC", [], (err, requirements) => {
                if (err) return res.status(500).json({ error: err.message });

                const totalGrossRevenue = sales.reduce((acc, s) => acc + (s.price_paid || 0), 0);
                const totalNetRevenue = sales.reduce((acc, s) => acc + (s.creator_net || 0), 0);
                const totalViews = listings.reduce((acc, l) => acc + (l.views || 0), 0);
                const totalSaves = listings.reduce((acc, l) => acc + (l.saves || 0), 0);
                const activeCount = listings.filter((l) => l.status === 'live' || l.status === 'published').length;

                res.json({
                  user,
                  metrics: {
                    total_gross_revenue: Math.round(totalGrossRevenue * 100) / 100,
                    total_net_revenue: Math.round(totalNetRevenue * 100) / 100,
                    total_views: totalViews,
                    total_saves: totalSaves,
                    active_listings_count: activeCount,
                    sealed_sales_count: sales.length,
                    payout_pending: Math.round(totalNetRevenue * 100) / 100,
                  },
                  listings: (listings || []).map(withPreview),
                  // Allow-listed: see CREATOR_VISIBLE_SALE_FIELDS above.
                  sealed_sales: (sales || []).map(creatorVisibleSale),
                  tracking_jobs: trackingJobs,
                  requirements,
                });
              });
            },
          );
        },
      );
    },
  );
});

router.get('/listings', requireSeller, (req, res) => {
  const pinitId = String(req.query.pinit_id || req.exchangeUser?.pinit_id || '').trim();
  if (!pinitId) return res.status(400).json({ error: 'pinit_id is required' });
  const listingScope = sellerMatchClause('pinit_id', pinitId);
  db.all(
    `SELECT * FROM listings ${whereClause(listingScope)} ORDER BY created_at DESC`,
    listingScope.params,
    (err, listings) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ listings: (listings || []).map(withPreview) });
    },
  );
});

router.get('/directory', (req, res) => {
  const query = `
    SELECT l.*, 
           COALESCE(NULLIF(u.name, ''), 'PINIT Creator') AS creator_name,
           COALESCE(u.bio, '') AS creator_bio,
           COALESCE(u.pinit_id, l.pinit_id) AS creator_pinit_id
    FROM listings l
    LEFT JOIN users u ON ${listingUserJoinSql('l', 'u')}
    WHERE ${publicListingSql()}
    ORDER BY l.created_at DESC
  `;
  db.all(query, [], (err, listingRows) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all(
      'SELECT seller_pinit_id, COUNT(*) AS sales FROM orders_sealed GROUP BY seller_pinit_id',
      [],
      async (salesErr, salesRows) => {
        if (salesErr) return res.status(500).json({ error: salesErr.message });
        const salesMap = {};
        (salesRows || []).forEach((row) => {
          const code = extractPinitCode(row.seller_pinit_id) || String(row.seller_pinit_id || '');
          salesMap[code] = (salesMap[code] || 0) + Number(row.sales || 0);
        });

        const grouped = {};
        (listingRows || []).forEach((item) => {
          const pinitId = item.creator_pinit_id || item.pinit_id;
          const code = extractPinitCode(pinitId) || String(pinitId || '');
          if (!grouped[code]) {
            grouped[code] = {
              pinit_id: pinitId,
              name: item.creator_name || 'PINIT Creator',
              bio: item.creator_bio || '',
              assets: 0,
              views: 0,
              verticals: [],
              portfolio: [],
              sales: salesMap[code] || 0,
              pinit_user_id: toUserPinitId(code),
            };
          }
          const g = grouped[code];
          g.assets += 1;
          g.views += Number(item.views || 0);
          if (item.vertical && !g.verticals.includes(item.vertical)) g.verticals.push(item.vertical);
          if (g.portfolio.length < 3) g.portfolio.push(withPreview(item));
        });

        const hubByCode = {};
        try {
          const { profiles } = await fetchHubProfiles(Object.values(grouped).map((c) => c.pinit_id));
          (profiles || []).forEach((profile) => {
            const code = extractPinitCode(profile.pinit_id || profile.pinit_user_id);
            if (code) hubByCode[code] = profile;
          });
        } catch (hubErr) {
          console.warn('[creator/directory] Hub profiles unavailable:', hubErr.message);
        }

        const creators = Object.values(grouped)
          .sort((a, b) => b.assets - a.assets)
          .slice(0, 48)
          .map((c) => {
            const code = extractPinitCode(c.pinit_id);
            return {
              ...applyHubProfile(c, hubByCode[code]),
              verticals: c.verticals.join(','),
            };
          });

        creators.forEach((c) => {
          if (!c.pinit_id || isPlaceholderName(c.name)) return;
          const match = sellerMatchClause('pinit_id', c.pinit_id);
          db.run(
            `UPDATE users SET name = ?, display_name = ? ${whereClause(match)}`,
            [c.name, c.name, ...match.params],
            () => {},
          );
        });

        res.json({ creators });
      },
    );
  });
});

router.get('/profile/:pinitId', (req, res) => {
  const pinitId = String(req.params.pinitId || '').trim();
  if (!pinitId) return res.status(400).json({ error: 'pinit_id is required' });
  const listingScope = sellerMatchClause('l.pinit_id', pinitId);
  const salesScope = sellerMatchClause('seller_pinit_id', pinitId);

  db.get(
    `SELECT u.* FROM users u ${whereClause(sellerMatchClause('u.pinit_id', pinitId))} LIMIT 1`,
    sellerMatchClause('u.pinit_id', pinitId).params,
    (userErr, user) => {
      if (userErr) return res.status(500).json({ error: userErr.message });
      db.all(
        `SELECT l.* FROM listings l ${whereClause(listingScope)} AND ${publicListingSql()} ORDER BY l.created_at DESC`,
        listingScope.params,
        (listErr, listings) => {
          if (listErr) return res.status(500).json({ error: listErr.message });
          db.all(
            `SELECT * FROM orders_sealed ${whereClause(salesScope)}`,
            salesScope.params,
            async (salesErr, sales) => {
              if (salesErr) return res.status(500).json({ error: salesErr.message });
              let hub = null;
              try {
                const { profiles } = await fetchHubProfiles([user?.pinit_id || pinitId]);
                hub = profiles?.[0] || null;
              } catch (hubErr) {
                console.warn('[creator/profile] Hub profile unavailable:', hubErr.message);
              }
              res.json({
                creator: applyHubProfile({
                  pinit_id: user?.pinit_id || pinitId,
                  name: user?.name || 'PINIT Creator',
                  bio: user?.bio || '',
                  exchange_id: user?.exchange_id || '',
                  identity_verified: true,
                  hub_connected: true,
                  assets: (listings || []).length,
                  sales: (sales || []).length,
                  pinit_user_id: toUserPinitId(user?.pinit_id || pinitId),
                }, hub),
                listings: (listings || []).map(withPreview),
              });
            },
          );
        },
      );
    },
  );
});

/**
 * GET /api/creator/assets/:assetId/activity — Asset 360, Exchange side.
 *
 * The engagement events Exchange emits (CART_ADDED, WISHLIST_ADDED, REVIEWED,
 * DOWNLOADED, PRICE_CHANGED…) are recorded on Hub's canonical timeline, but a
 * creator standing in Exchange had no way to see any of it. This assembles the
 * commercial picture from Exchange's own rows, all keyed on the canonical
 * Asset.id, so it needs no Hub round-trip and no new tables.
 *
 * Two rules it does not bend:
 *  - Ownership is proved by the listing, not by the caller. A creator can only
 *    read an asset they publish.
 *  - Counts are counts. Every figure below is a COUNT or SUM over real rows —
 *    nothing is seeded, defaulted or estimated. An asset with no activity
 *    reports zeroes, which is the honest answer.
 *  - No buyer PII. Purchases are represented by public Pinit IDs only; buyer
 *    name, email and organisation never leave the server here.
 */
router.get('/assets/:assetId/activity', requireSeller, (req, res) => {
  const assetId = String(req.params.assetId || '').trim();
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  const pinitId = req.exchangeUser?.pinit_id;
  const ownerScope = sellerMatchClause('l.pinit_id', pinitId);

  // Ownership first. A non-owner and a non-existent asset are deliberately
  // indistinguishable — 404 either way, so this cannot be used to probe which
  // asset ids exist.
  // sellerMatchClause returns a leading " AND ...", so it appends directly to
  // a WHERE that already has a condition. Stripping the AND by hand would
  // break silently if that helper ever changed shape.
  db.get(
    `SELECT l.* FROM listings l WHERE l.asset_id = ?${ownerScope.sql}`,
    [assetId, ...ownerScope.params],
    (err, listing) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!listing) return res.status(404).json({ error: 'Asset not found' });

      const one = (sql, params) => new Promise((resolve) => {
        db.get(sql, params, (e, row) => resolve(e ? {} : (row || {})));
      });
      const many = (sql, params) => new Promise((resolve) => {
        db.all(sql, params, (e, rows) => resolve(e ? [] : (rows || [])));
      });

      Promise.all([
        one(`SELECT COUNT(*) AS n,
                    COALESCE(SUM(price_paid), 0)  AS gross,
                    COALESCE(SUM(platform_fee), 0) AS fees,
                    COALESCE(SUM(creator_net), 0)  AS net,
                    COALESCE(SUM(download_count), 0) AS downloads
               FROM orders_sealed WHERE asset_id = ?`, [assetId]),
        one(`SELECT COUNT(*) AS n FROM wishlist   WHERE asset_id = ?`, [assetId]),
        one(`SELECT COUNT(*) AS n FROM cart_items WHERE asset_id = ?`, [assetId]),
        one(`SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE asset_id = ?`, [assetId]),
        one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM refunds WHERE asset_id = ?`, [assetId]),
        many(`SELECT seal_id, license_tier, price_paid, creator_net, currency,
                     status, payment_status, license_status, delivery_status,
                     download_count, download_limit, sealed_at, buyer_pinit_id
                FROM orders_sealed WHERE asset_id = ?
               ORDER BY sealed_at DESC LIMIT 20`, [assetId]),
        many(`SELECT rating, comment, buyer_pinit_id, created_at
                FROM reviews WHERE asset_id = ? ORDER BY created_at DESC LIMIT 10`, [assetId]),
      ]).then(([sales, wish, cart, rev, refund, recentSales, recentReviews]) => {
        // Every aggregate is coerced with Number() before use. The Postgres
        // driver returns COUNT/SUM as strings, so comparisons and arithmetic
        // on the raw values are unreliable.
        const grossNum = Number(sales.gross || 0);
        const salesCount = Number(sales.n || 0);
        const viewsNum = Number(listing.views || 0);
        const reviewCount = Number(rev.n || 0);

        res.json({
          asset_id: assetId,
          listing: {
            listing_id: listing.listing_id,
            title: listing.title,
            vertical: listing.vertical,
            status: listing.status,
            badge_tier: listing.badge_tier,
            created_at: listing.created_at,
            price_personal: listing.price_personal,
            price_commercial: listing.price_commercial,
            price_exclusive: listing.price_exclusive,
            price_enterprise: listing.price_enterprise,
          },
          engagement: {
            views: viewsNum,
            saves: Number(listing.saves || 0),
            wishlisted_now: Number(wish.n || 0),
            in_carts_now: Number(cart.n || 0),
            // Real ratio of sales to views. Null rather than 0 when there is
            // nothing to divide by — "no data yet" is not "0% conversion".
            conversion_rate: viewsNum > 0 ? Number(((salesCount / viewsNum) * 100).toFixed(2)) : null,
          },
          commerce: {
            sales_count: salesCount,
            gross_revenue: Math.round(grossNum * 100) / 100,
            platform_fees: Math.round(Number(sales.fees || 0) * 100) / 100,
            creator_net: Math.round(Number(sales.net || 0) * 100) / 100,
            refunds_count: Number(refund.n || 0),
            refunds_amount: Math.round(Number(refund.amount || 0) * 100) / 100,
          },
          delivery: {
            total_downloads: Number(sales.downloads || 0),
          },
          reviews: {
            count: reviewCount,
            // Null when there are no reviews — never a defaulted score.
            //
            // Guarded on Number(), not on the raw value: the Postgres driver
            // returns COUNT(*) as the string "0", which is truthy, so a
            // truthiness check reported an average of 0 stars for an asset
            // with no reviews at all.
            average: reviewCount > 0 ? Number(Number(rev.avg || 0).toFixed(2)) : null,
            recent: recentReviews,
          },
          // Buyer identity limited to the public Pinit ID.
          recent_sales: recentSales,
        });
      });
    },
  );
});

export default router;
