import express from 'express';
import db from '../database.js';
import { verifyHubBridgeToken, confirmListingWithHub } from '../hub-client.js';
import { exchangePreviewUrl, PLACEHOLDER_PREVIEW } from '../lib/preview-url.js';
import { postAssetActivity } from '../lib/asset-activity.js';
import { LISTING_STATUS, publicListingWithSellerSql, BRIDGE_EVENT } from '../lib/lifecycle.js';
import { recordBridgeEvent, markBridgeEventProcessed } from '../lib/bridge-events.js';
import { getSql, runSql } from '../lib/db.js';
import { toExchangePinitId, listingUserJoinSql, sellerMatchClause, extractPinitCode } from '../lib/pinit-identity.js';
import { canList, buyerDeniedList } from '../lib/roles.js';
import { findUserByPinitId, requireSeller, requireActiveSeller } from '../lib/rbac.js';

const router = express.Router();

function verticalFilterClause(vertical) {
  const v = String(vertical || '').toLowerCase().trim();
  if (!v || v === 'all' || v === 'mine') return { sql: '', params: [] };
  if (v === 'images' || v === 'image' || v === 'photography') {
    return {
      sql: ` AND LOWER(l.vertical) IN ('images', 'image', 'photography')`,
      params: [],
    };
  }
  if (v === 'video' || v === 'videos') {
    return {
      sql: ` AND (LOWER(l.vertical) IN ('video', 'videos') OR LOWER(l.vertical) LIKE 'video%')`,
      params: [],
    };
  }
  if (v === 'audio' || v === 'music') {
    return {
      sql: ` AND LOWER(l.vertical) IN ('audio', 'music')`,
      params: [],
    };
  }
  if (v === 'documents' || v === 'document' || v === 'docs') {
    return {
      sql: ` AND LOWER(l.vertical) IN ('documents', 'document', 'docs', 'pdf')`,
      params: [],
    };
  }
  if (v === 'design' || v === 'ui_ux') {
    return {
      sql: ` AND LOWER(l.vertical) IN ('ui_ux', 'design', 'graphics')`,
      params: [],
    };
  }
  if (v === 'other' || v === 'concepts') {
    return {
      sql: ` AND LOWER(l.vertical) IN ('concepts', 'other', 'illustration')`,
      params: [],
    };
  }
  if (v === '3d') {
    return {
      sql: ` AND LOWER(l.vertical) IN ('3d', '3d_models')`,
      params: [],
    };
  }
  return { sql: ` AND l.vertical = ?`, params: [vertical] };
}

function upsertHubAssetFromIntent(intent, cb) {
  if (!intent || intent.purpose !== 'exchange_list_intent') {
    return cb(new Error('Invalid Hub list intent token'));
  }

  const assetId = intent.assetId || intent.vaultId;
  const pinitId = toExchangePinitId(intent.pinitId) || intent.pinitId || 'PINIT-UNKNOWN';
  const title = intent.title || 'Protected Hub Asset';
  const fileTypeRaw = intent.fileType || intent.mimeType || 'images';
  const fileType = String(fileTypeRaw).toLowerCase().startsWith('image') ? 'images'
    : String(fileTypeRaw).toLowerCase().startsWith('video') ? 'video'
    : String(fileTypeRaw).toLowerCase().startsWith('audio') ? 'audio'
    : String(fileTypeRaw).toLowerCase() === 'image' ? 'images'
    : String(fileTypeRaw).toLowerCase() === 'documents' || String(fileTypeRaw).toLowerCase() === 'document' ? 'concepts'
    : (String(fileTypeRaw).toLowerCase() || 'images');
  const vertical = fileType === 'image' ? 'images' : fileType;
  const previewUrl = exchangePreviewUrl(assetId, intent.previewUrl || PLACEHOLDER_PREVIEW);
  const dnaRecordId = intent.dnaRecordId || `DNA-${String(assetId).slice(0, 8)}`;
  const humanPercent = intent.humanPercent != null ? Number(intent.humanPercent) : 90;
  const aiPercent = intent.aiPercent != null ? Number(intent.aiPercent) : Math.max(0, 100 - humanPercent);
  const badgeTier = intent.badgeTier || (humanPercent >= 90 ? 'Gold' : humanPercent >= 60 ? 'Silver' : 'Bronze');

  db.run(`
    INSERT INTO hub_assets (
      asset_id, pinit_id, title, file_type, vertical, preview_url,
      vault_encrypted, dna_record_id, human_percent, ai_percent, badge_tier
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET
      title = excluded.title,
      human_percent = excluded.human_percent,
      ai_percent = excluded.ai_percent,
      badge_tier = excluded.badge_tier,
      dna_record_id = excluded.dna_record_id
  `, [
    assetId, pinitId, title, fileType, vertical, previewUrl,
    dnaRecordId, humanPercent, aiPercent, badgeTier,
  ], (err) => {
    if (err) return cb(err);
    db.get('SELECT * FROM hub_assets WHERE asset_id = ?', [assetId], cb);
  });
}

// Get all marketplace listings with filtering, search & LEFT JOIN robustness
router.get('/', (req, res) => {
  const { vertical, search, badge, sort } = req.query;

  let query = `
    SELECT l.*, 
           COALESCE(NULLIF(u.name, ''), 'PINIT User') as creator_name, 
           COALESCE(u.exchange_id, '') as creator_exchange_id, 
           COALESCE(u.kyc_status, 'pending') as creator_kyc
    FROM listings l
    INNER JOIN users u ON ${listingUserJoinSql('l', 'u')}
    WHERE ${publicListingWithSellerSql()}
  `;
  const params = [];

  const verticalClause = verticalFilterClause(vertical);
  query += verticalClause.sql;
  params.push(...verticalClause.params);

  if (req.query.seller || req.query.pinit_id) {
    const sellerClause = sellerMatchClause('l.pinit_id', req.query.seller || req.query.pinit_id);
    query += sellerClause.sql;
    params.push(...sellerClause.params);
  }

  if (badge && badge !== 'all') {
    query += ` AND l.badge_tier = ?`;
    params.push(badge);
  }

  // ---- Additive filters -------------------------------------------------
  // All four are optional. Omitting them reproduces the previous behaviour
  // exactly, so existing callers are unaffected.

  // Licence tier: only offer listings the creator actually priced for that
  // tier. A tier with no price is not on sale, so `> 0` is the real test —
  // the same rule the storefront uses when building the tier rail.
  const LICENCE_TIERS = ['personal', 'commercial', 'exclusive', 'enterprise'];
  const licence = String(req.query.licence || req.query.license || '').trim().toLowerCase();
  if (licence && licence !== 'all' && LICENCE_TIERS.includes(licence)) {
    query += ` AND COALESCE(l.price_${licence}, 0) > 0`;
  }

  // Price range. Compared against the tier being filtered on when one is
  // given, otherwise against the cheapest published tier — which is the
  // "From $X" figure the buyer sees on the card, so the filter matches what
  // they are looking at rather than some hidden column.
  const priceCol = licence && LICENCE_TIERS.includes(licence)
    ? `l.price_${licence}`
    : `COALESCE(NULLIF(l.price_personal, 0), NULLIF(l.price_commercial, 0), NULLIF(l.price_exclusive, 0), NULLIF(l.price_enterprise, 0))`;
  const priceMin = Number(req.query.price_min);
  const priceMax = Number(req.query.price_max);
  if (Number.isFinite(priceMin) && priceMin > 0) {
    query += ` AND ${priceCol} >= ?`;
    params.push(priceMin);
  }
  if (Number.isFinite(priceMax) && priceMax > 0) {
    query += ` AND ${priceCol} <= ?`;
    params.push(priceMax);
  }

  // Media type. `vertical` is a Discover filter (Images, Design, Other),
  // not the product identity. The
  // authoritative answer is hub_assets.file_type, mirrored from Hub at list
  // time. Matched with a correlated EXISTS so the main query keeps returning
  // one row per listing — a JOIN here would duplicate rows if an asset ever
  // gained a second hub_assets entry.
  const media = String(req.query.media || '').trim().toLowerCase();
  if (media === 'image' || media === 'video') {
    const like = media === 'video' ? 'video%' : 'image%';
    query += ` AND EXISTS (
      SELECT 1 FROM hub_assets ha2
       WHERE ha2.asset_id = l.asset_id
         AND (LOWER(COALESCE(ha2.file_type,'')) LIKE ?
              OR LOWER(COALESCE(l.vertical,'')) = ?)
    )`;
    params.push(like, media === 'video' ? 'video' : 'images');
  }

  const creator = String(req.query.creator || '').trim();
  if (creator) {
    const creatorPattern = `%${creator}%`;
    query += ` AND (
      LOWER(COALESCE(u.name,'')) LIKE LOWER(?)
      OR LOWER(l.pinit_id) LIKE LOWER(?)
      OR LOWER(COALESCE(u.exchange_id,'')) LIKE LOWER(?)
    )`;
    params.push(creatorPattern, creatorPattern, creatorPattern);
  }

  if (search) {
    // LOWER(...) LIKE LOWER(?) rather than IFNULL/ILIKE.
    //
    // This clause used IFNULL, which is SQLite/MySQL only — on Postgres it
    // raised "function ifnull(text, unknown) does not exist" and every search
    // returned HTTP 500. ILIKE would fix Postgres but break SQLite, so both
    // sides use LOWER()+LIKE, which is standard SQL and gives case-insensitive
    // matching on either driver (Postgres LIKE is case-sensitive by default).
    query += ` AND (
      LOWER(l.title) LIKE LOWER(?) OR LOWER(l.description) LIKE LOWER(?)
      OR LOWER(l.tags) LIKE LOWER(?) OR LOWER(COALESCE(l.tagline,'')) LIKE LOWER(?)
      OR LOWER(l.asset_id) LIKE LOWER(?) OR LOWER(l.listing_id) LIKE LOWER(?)
      OR LOWER(COALESCE(u.name,'')) LIKE LOWER(?) OR LOWER(l.pinit_id) LIKE LOWER(?)
    )`;
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
  }

  if (sort === 'price_asc') {
    query += ` ORDER BY l.price_personal ASC`;
  } else if (sort === 'price_desc') {
    query += ` ORDER BY l.price_personal DESC`;
  } else if (sort === 'popular') {
    query += ` ORDER BY l.views DESC`;
  } else {
    query += ` ORDER BY l.created_at DESC`;
  }

  // Pagination. Previously this returned every published listing in one
  // unbounded query, which is fine at two listings and fatal at ten thousand.
  // A hard ceiling means no caller can request the whole table.
  const MAX_LIMIT = 60;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  // Count before slicing so the client can render "showing 24 of 812".
  const countQuery = `SELECT COUNT(*) AS total FROM (${query}) AS filtered`;

  const pagedQuery = `${query} LIMIT ? OFFSET ?`;
  const pagedParams = [...params, limit, offset];

  db.get(countQuery, params, (countErr, countRow) => {
    const total = countErr ? null : Number(countRow?.total ?? 0);

    db.all(pagedQuery, pagedParams, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const assetIds = [...new Set((rows || []).map((item) => item.asset_id).filter(Boolean))];
    const attach = (assets) => {
      const assetMap = {};
      (assets || []).forEach((a) => { assetMap[a.asset_id] = a; });
      const enrichedRows = rows.map((item) => ({
        ...item,
        preview_url: exchangePreviewUrl(
          item.asset_id,
          assetMap[item.asset_id]?.preview_url || PLACEHOLDER_PREVIEW,
        ),
        file_type: assetMap[item.asset_id]?.file_type || item.vertical || 'images',
      }));

      // The body stays a plain ARRAY and paging travels in headers.
      //
      // This endpoint briefly returned an { items, total, ... } envelope. The
      // Exchange frontend and backend deploy independently, so the backend
      // shipped first and every already-deployed client called .filter() on an
      // object - the whole marketplace crashed with "o.filter is not a
      // function" until the frontend caught up. Keeping the body shape stable
      // means neither side can break the other by deploying first.
      const hasMore = total === null
        ? enrichedRows.length === limit
        : offset + enrichedRows.length < total;

      res.set({
        'X-Total-Count': total === null ? '' : String(total),
        'X-Limit': String(limit),
        'X-Offset': String(offset),
        'X-Has-More': hasMore ? 'true' : 'false',
        // Needed for a cross-origin frontend to read the paging headers.
        'Access-Control-Expose-Headers': 'X-Total-Count, X-Limit, X-Offset, X-Has-More',
      });
      res.json(enrichedRows);
    };

    if (!assetIds.length) return attach([]);
    const placeholders = assetIds.map(() => '?').join(',');
    db.all(
      `SELECT asset_id, preview_url, file_type FROM hub_assets WHERE asset_id IN (${placeholders})`,
      assetIds,
      (assetErr, assets) => {
        if (assetErr) return res.status(500).json({ error: assetErr.message });
        attach(assets);
      },
    );
    });
  });
});

// Get single listing by ID with full creator passport and DNA summary
router.get('/:id', (req, res) => {
  const listingId = req.params.id;

  const query = `
    SELECT l.*, 
           COALESCE(NULLIF(u.name, ''), 'PINIT User') as creator_name, 
           COALESCE(u.exchange_id, '') as creator_exchange_id, 
           COALESCE(u.bio, '') as creator_bio, 
           COALESCE(u.kyc_status, 'pending') as kyc_status, 
           COALESCE(u.biometric_verified, 0) as biometric_verified,
           COALESCE(ha.preview_url, '') as cached_preview_url, 
           COALESCE(ha.file_type, l.vertical, 'images') as file_type, 
           COALESCE(ha.dna_record_id, '') as dna_record_id, 
           COALESCE(ha.vault_encrypted, 1) as vault_encrypted
    FROM listings l
    INNER JOIN users u ON ${listingUserJoinSql('l', 'u')}
    LEFT JOIN hub_assets ha ON l.asset_id = ha.asset_id
    WHERE l.listing_id = ?
  `;

  db.get(query, [listingId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) {
      return res.status(404).json({
        error: 'Listing not found',
        message: 'This listing is no longer available on Exchange.',
      });
    }
    row.preview_url = exchangePreviewUrl(row.asset_id, row.cached_preview_url || PLACEHOLDER_PREVIEW);
    delete row.cached_preview_url;

    // Increment view count, excluding the creator's own visits — otherwise a
    // seller inflates their own analytics just by checking their listing.
    const viewerPinitId = String(req.query.viewer_pinit_id || req.headers['x-pinit-id'] || '').trim();
    const isOwnListing = viewerPinitId && String(row.pinit_id || '') === viewerPinitId;
    if (!isOwnListing) {
      db.run("UPDATE listings SET views = views + 1 WHERE listing_id = ?", [listingId]);
    }

    res.json(row);

    // Record the real view on the canonical asset timeline. The pre-existing
    // `views` counter is NOT replayed into the timeline — only views that
    // actually happen from here on are captured as events.
    if (row.asset_id) {
      postAssetActivity({
        assetId: row.asset_id,
        eventType: 'VIEWED',
        title: 'Listing viewed',
        detail: `Listing ${listingId}`,
        payload: { listingId },
      });
    }
  });
});

/** Accept Hub list-intent JWT and prepare asset for listing modal */
router.post('/from-hub', requireActiveSeller, (req, res) => {
  const token = req.body?.hub_list_token || req.body?.token;
  let intent;
  try {
    intent = verifyHubBridgeToken(token, 'exchange_list_intent');
  } catch (e) {
    return res.status(e.status || 401).json({
      error: e.message || 'Invalid or missing Hub list intent token',
      hint: 'Open the asset in Pinit HUB Vault and click List on Exchange again.',
    });
  }

  findUserByPinitId(intent.pinitId).then((seller) => {
    if (!seller || !canList(seller.role)) {
      return res.status(403).json(buyerDeniedList());
    }
    upsertHubAssetFromIntent(intent, (err, asset) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        message: 'Hub asset ready for Exchange listing',
        asset,
        intent: {
          asset_id: asset.asset_id,
          pinit_id: asset.pinit_id,
          title: asset.title,
          human_percent: asset.human_percent,
          ai_percent: asset.ai_percent,
          badge_tier: asset.badge_tier,
          dna_record_id: asset.dna_record_id,
        },
      });
    });
  }).catch((err) => res.status(500).json({ error: err.message }));
});

// Create / Publish Listing from Hub to Exchange (WITH MANDATORY SECTION 9 AI POLICY CHECK)
router.post('/', requireActiveSeller, (req, res) => {
  const {
    asset_id,
    pinit_id,
    title,
    description,
    tagline,
    vertical,
    tags,
    price_personal,
    price_commercial,
    price_exclusive,
    price_enterprise,
    ai_training_opt_out,
    human_percent,
    ai_percent,
    hub_list_token,
  } = req.body;

  if (hub_list_token) {
    let intent;
    try {
      intent = verifyHubBridgeToken(hub_list_token, 'exchange_list_intent');
    } catch (e) {
      return res.status(e.status || 401).json({ error: e.message || 'Invalid Hub list token' });
    }
    upsertHubAssetFromIntent(intent, (err) => {
      if (err) return res.status(401).json({ error: err.message });
      publishListing();
    });
  } else {
    publishListing();
  }

  function publishListing() {
  const sellerPinitId = req.exchangeUser?.pinit_id || pinit_id;
  if (!sellerPinitId) {
    return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Sign in as a Creator to publish listings.' });
  }

  if (!asset_id) {
    return res.status(400).json({ error: "asset_id is required from Pinit HUB Vault" });
  }

  // Fetch Hub Asset to evaluate DNA and AI score
  db.get("SELECT * FROM hub_assets WHERE asset_id = ?", [asset_id], (err, hubAsset) => {
    if (err) return res.status(500).json({ error: err.message });

    // Prefer explicit payload scores if sent from modal sliders, otherwise fallback to database
    const effectiveAiPercent = (ai_percent !== undefined && ai_percent !== null) ? Number(ai_percent) : (hubAsset ? hubAsset.ai_percent : 10);
    const effectiveHumanPercent = (human_percent !== undefined && human_percent !== null) ? Number(human_percent) : (hubAsset ? hubAsset.human_percent : 90);
    
    const assetTitle = title || (hubAsset ? hubAsset.title : 'Untitled Provenance Work');
    let assetVertical = vertical || (hubAsset ? hubAsset.vertical : 'images');
    if (assetVertical === 'image') assetVertical = 'images';
    if (assetVertical === 'documents' || assetVertical === 'document') assetVertical = 'concepts';

    // Keep local Hub asset cache in sync so marketplace previews resolve
    if (!hubAsset) {
      db.run(`
        INSERT INTO hub_assets (
          asset_id, pinit_id, title, file_type, vertical, preview_url,
          vault_encrypted, dna_record_id, human_percent, ai_percent, badge_tier
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `, [
        asset_id, sellerPinitId, assetTitle, assetVertical, assetVertical,
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
        `DNA-${String(asset_id).slice(0, 8)}`,
        effectiveHumanPercent, effectiveAiPercent,
        effectiveHumanPercent >= 90 ? 'Gold' : effectiveHumanPercent >= 60 ? 'Silver' : 'Bronze',
      ]);
    } else {
      db.run("UPDATE hub_assets SET human_percent = ?, ai_percent = ?, title = ?, vertical = ? WHERE asset_id = ?", [
        effectiveHumanPercent, effectiveAiPercent, assetTitle, assetVertical, asset_id,
      ]);
    }

    // SECTION 9 MANDATORY AI POLICY CHECK: IF AI > 80%, BLOCK PUBLISH!
    if (effectiveAiPercent > 80) {
      return res.status(400).json({
        error: "AI_POLICY_VIOLATION",
        message: "This asset exceeds the 80% AI-content limit and cannot be listed on Pinit Exchange.",
        ai_percent: effectiveAiPercent,
        limit: 80
      });
    }

    db.get('SELECT * FROM asset_commerce_locks WHERE asset_id = ?', [asset_id], async (lockErr, lock) => {
      if (lockErr) return res.status(500).json({ error: lockErr.message });
      if (lock) {
        return res.status(409).json({
          error: 'ASSET_EXCLUSIVELY_LOCKED',
          message: 'This asset was sold exclusively and cannot be listed again.',
        });
      }

      const prot = String(hubAsset?.protection_status || 'protected').toLowerCase();
      if (prot === 'protection_pending' || prot === 'protection_failed') {
        return res.status(409).json({
          error: 'PROTECTION_NOT_READY',
          message: prot === 'protection_failed'
            ? 'Hub protection failed. Retry silent protect before publishing.'
            : 'Hub protection still pending. Listing cannot be published yet.',
          protection_status: prot,
        });
      }

    // Determine Badge Tier based on Human Authenticity
    let badgeTier = 'Bronze';
    if (effectiveHumanPercent >= 90) {
      badgeTier = 'Gold';
    } else if (effectiveHumanPercent >= 60) {
      badgeTier = 'Silver';
    } else {
      badgeTier = 'Bronze';
    }

    const dnaHash = '0x' + Array.from({length: 32}, () => Math.floor(Math.random()*16).toString(16)).join('');
    const taglineVal = (tagline && String(tagline).trim()) || '';
    const descVal = description || '';
    const tagsVal = tags || 'pinit,verified';
    const prices = [
      price_personal || 49,
      price_commercial || 149,
      price_exclusive || 899,
      price_enterprise || 2499,
    ];
    const optOut = ai_training_opt_out ? 1 : 0;

    const finishPublish = (listingId) => {
      db.get("SELECT l.*, COALESCE(u.name, 'Creator') as creator_name FROM listings l LEFT JOIN users u ON l.pinit_id = u.pinit_id WHERE l.listing_id = ?", [listingId], async (err, newListing) => {
        if (err) return res.status(500).json({ error: err.message });

        let hubConfirm = null;
        try {
          hubConfirm = await confirmListingWithHub({
            vaultId: asset_id,
            listingId,
            pinitId: sellerPinitId,
            exchangeUrl: `${process.env.EXCHANGE_PUBLIC_URL || 'http://localhost:5174'}/?listing=${listingId}`,
            status: LISTING_STATUS.PUBLISHED,
          });
        } catch (confirmErr) {
          console.warn('[listings] Hub confirm failed:', confirmErr.message);
          hubConfirm = { error: confirmErr.message };
        }

        try {
          const { event, duplicate } = await recordBridgeEvent({
            eventType: BRIDGE_EVENT.LISTED,
            idempotencyKey: `LISTED:${listingId}`,
            assetId: asset_id,
            listingId,
            payload: { pinitId: sellerPinitId },
          });
          if (!duplicate && event?.id) await markBridgeEventProcessed(event.id);
        } catch (evErr) {
          console.warn('[listings] LISTED event failed:', evErr.message);
        }

        res.status(201).json({
          message: 'Listing published successfully to Pinit Exchange',
          listing: {
            ...newListing,
            preview_url: exchangePreviewUrl(asset_id, hubAsset?.preview_url || PLACEHOLDER_PREVIEW),
          },
          badge_assigned: badgeTier,
          hub_confirm: hubConfirm,
        });
      });
    };

    db.get(
      `SELECT * FROM listings WHERE asset_id = ? AND pinit_id = ? AND status != ?
       ORDER BY created_at DESC LIMIT 1`,
      [asset_id, sellerPinitId, LISTING_STATUS.SOLD_EXCLUSIVE],
      (existErr, existing) => {
        if (existErr) return res.status(500).json({ error: existErr.message });

        if (existing) {
          db.run(`
            UPDATE listings SET
              title = ?, description = ?, tagline = ?, vertical = ?, tags = ?,
              price_personal = ?, price_commercial = ?, price_exclusive = ?, price_enterprise = ?,
              ai_training_opt_out = ?, status = ?, badge_tier = ?, human_percent = ?, ai_percent = ?
            WHERE listing_id = ?
          `, [
            assetTitle, descVal, taglineVal, assetVertical, tagsVal,
            ...prices, optOut, LISTING_STATUS.PUBLISHED, badgeTier,
            effectiveHumanPercent, effectiveAiPercent, existing.listing_id,
          ], (updErr) => {
            if (updErr) return res.status(500).json({ error: updErr.message });
            finishPublish(existing.listing_id);

            // Compare the prices actually stored before the update against the
            // ones just written, so PRICE_CHANGED reflects a real change only.
            const before = [
              existing.price_personal, existing.price_commercial,
              existing.price_exclusive, existing.price_enterprise,
            ];
            const changed = prices.some((v, i) => Number(v) !== Number(before[i]));

            postAssetActivity({
              assetId: asset_id,
              eventType: 'LISTING_UPDATED',
              title: 'Listing updated',
              detail: `Listing ${existing.listing_id}`,
              payload: { listingId: existing.listing_id, status: LISTING_STATUS.PUBLISHED },
            });

            if (changed) {
              postAssetActivity({
                assetId: asset_id,
                eventType: 'PRICE_CHANGED',
                title: 'Price changed',
                detail: `Listing ${existing.listing_id}`,
                payload: {
                  listingId: existing.listing_id,
                  from: { personal: before[0], commercial: before[1], exclusive: before[2], enterprise: before[3] },
                  to: { personal: prices[0], commercial: prices[1], exclusive: prices[2], enterprise: prices[3] },
                },
              });
            }
          });
          return;
        }

        const listingId = 'L-' + Math.floor(10000 + Math.random() * 90000);
        db.run(`
          INSERT INTO listings (
            listing_id, asset_id, pinit_id, title, description, tagline, vertical, tags,
            price_personal, price_commercial, price_exclusive, price_enterprise,
            ai_training_opt_out, status, badge_tier, human_percent, ai_percent, dna_hash, views, saves
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
        `, [
          listingId, asset_id, sellerPinitId, assetTitle, descVal, taglineVal, assetVertical, tagsVal,
          ...prices, optOut, LISTING_STATUS.PUBLISHED, badgeTier,
          effectiveHumanPercent, effectiveAiPercent, dnaHash,
        ], function (insErr) {
          if (insErr) return res.status(500).json({ error: insErr.message });
          finishPublish(listingId);
        });
      },
    );
    });
  });
  }
});

/** POST /api/listings/:id/status — seller lifecycle transitions */
router.post('/:id/status', requireSeller, async (req, res) => {
  try {
    const listingId = req.params.id;
    const sellerId = req.exchangeUser?.pinit_id || String(req.body?.pinit_id || '').trim();
    const next = String(req.body?.status || '').toLowerCase();
    if (!sellerId) return res.status(400).json({ error: 'pinit_id is required' });

    const allowed = new Set([
      LISTING_STATUS.UNLISTED,
      LISTING_STATUS.PUBLISHED,
      LISTING_STATUS.SUSPENDED,
      LISTING_STATUS.ARCHIVED,
    ]);
    if (!allowed.has(next)) {
      return res.status(400).json({ error: `status must be one of: ${[...allowed].join(', ')}` });
    }

    const row = await getSql('SELECT * FROM listings WHERE listing_id = ?', [listingId]);
    if (!row) return res.status(404).json({ error: 'Listing not found' });
    const sameFace = extractPinitCode(row.pinit_id) && extractPinitCode(row.pinit_id) === extractPinitCode(sellerId);
    if (row.pinit_id !== sellerId && !sameFace) {
      return res.status(403).json({ error: 'Only the seller can change listing status' });
    }
    if (row.status === LISTING_STATUS.SOLD_EXCLUSIVE) {
      return res.status(409).json({ error: 'Exclusive sale is final; cannot change marketplace status' });
    }

    await runSql('UPDATE listings SET status = ? WHERE listing_id = ?', [next, listingId]);

    if (next === LISTING_STATUS.UNLISTED) {
      const { event, duplicate } = await recordBridgeEvent({
        eventType: BRIDGE_EVENT.UNLISTED,
        idempotencyKey: `UNLISTED:${listingId}:${Date.now()}`,
        assetId: row.asset_id,
        listingId,
      });
      if (!duplicate && event?.id) await markBridgeEventProcessed(event.id);
    }

    const updated = await getSql('SELECT * FROM listings WHERE listing_id = ?', [listingId]);
    res.json({ message: 'Listing status updated', listing: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/listings/:id — seller edits title, tagline, tags, description, prices */
router.patch('/:id', requireSeller, (req, res) => {
  const listingId = req.params.id;
  const sellerId = req.exchangeUser?.pinit_id || String(req.body?.pinit_id || '').trim();
  if (!sellerId) return res.status(400).json({ error: 'pinit_id is required' });

  db.get('SELECT * FROM listings WHERE listing_id = ?', [listingId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Listing not found' });
    if (row.pinit_id !== sellerId) return res.status(403).json({ error: 'Only the seller can edit this listing' });

    const title = req.body.title != null ? String(req.body.title).trim() : row.title;
    const tagline = req.body.tagline != null ? String(req.body.tagline).trim() : (row.tagline || '');
    const description = req.body.description != null ? String(req.body.description).trim() : (row.description || '');
    const tags = req.body.tags != null ? String(req.body.tags).trim() : (row.tags || '');
    const price_personal = req.body.price_personal != null ? Number(req.body.price_personal) : row.price_personal;
    const price_commercial = req.body.price_commercial != null ? Number(req.body.price_commercial) : row.price_commercial;
    const price_exclusive = req.body.price_exclusive != null ? Number(req.body.price_exclusive) : row.price_exclusive;
    const price_enterprise = req.body.price_enterprise != null ? Number(req.body.price_enterprise) : row.price_enterprise;
    const vertical = req.body.vertical != null ? String(req.body.vertical).trim() : row.vertical;

    db.run(`
      UPDATE listings SET
        title = ?, tagline = ?, description = ?, tags = ?, vertical = ?,
        price_personal = ?, price_commercial = ?, price_exclusive = ?, price_enterprise = ?
      WHERE listing_id = ?
    `, [
      title, tagline, description, tags, vertical,
      price_personal, price_commercial, price_exclusive, price_enterprise,
      listingId,
    ], function(updateErr) {
      if (updateErr) return res.status(500).json({ error: updateErr.message });
      db.get(`
        SELECT l.*, COALESCE(u.name, 'Creator') as creator_name,
               COALESCE(u.exchange_id, '') as creator_exchange_id
        FROM listings l LEFT JOIN users u ON l.pinit_id = u.pinit_id
        WHERE l.listing_id = ?
      `, [listingId], (err2, updated) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ message: 'Listing updated', listing: updated });
      });
    });
  });
});

export default router;
