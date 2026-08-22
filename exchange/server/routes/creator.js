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

export default router;
