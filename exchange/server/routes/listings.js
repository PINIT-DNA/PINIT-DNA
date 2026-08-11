import express from 'express';
import db from '../database.js';
import { verifyHubBridgeToken, confirmListingWithHub } from '../hub-client.js';
import { exchangePreviewUrl, PLACEHOLDER_PREVIEW } from '../lib/preview-url.js';
import { LISTING_STATUS, publicListingSql, BRIDGE_EVENT } from '../lib/lifecycle.js';
import { recordBridgeEvent, markBridgeEventProcessed } from '../lib/bridge-events.js';
import { getSql, runSql } from '../lib/db.js';

const router = express.Router();

function upsertHubAssetFromIntent(intent, cb) {
  if (!intent || intent.purpose !== 'exchange_list_intent') {
    return cb(new Error('Invalid Hub list intent token'));
  }

  const assetId = intent.assetId || intent.vaultId;
  const pinitId = intent.pinitId || 'PINIT-UNKNOWN';
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
    db.run(`
      INSERT OR IGNORE INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan, bio)
      VALUES (?, ?, 'Pinit Creator', ?, 'creator', 'pending', 1, 'starter', 'Connected via Pinit HUB')
    `, [
      pinitId,
      'PX-' + Math.floor(100000 + Math.random() * 900000),
      `${String(pinitId).toLowerCase().replace(/[^a-z0-9]/g, '')}@pinithub.local`,
    ], () => {
      db.get('SELECT * FROM hub_assets WHERE asset_id = ?', [assetId], cb);
    });
  });
}

// Get all marketplace listings with filtering, search & LEFT JOIN robustness
router.get('/', (req, res) => {
  const { vertical, search, badge, sort } = req.query;

  let query = `
    SELECT l.*, 
           COALESCE(u.name, 'Elena Rostova') as creator_name, 
           COALESCE(u.exchange_id, 'PX-772091') as creator_exchange_id, 
           COALESCE(u.kyc_status, 'verified') as creator_kyc
    FROM listings l
    LEFT JOIN users u ON l.pinit_id = u.pinit_id
    WHERE ${publicListingSql()}
  `;
  const params = [];

  if (vertical && vertical !== 'all') {
    query += ` AND l.vertical = ?`;
    params.push(vertical);
  }

  if (req.query.seller || req.query.pinit_id) {
    query += ` AND l.pinit_id = ?`;
    params.push(String(req.query.seller || req.query.pinit_id).trim());
  }

  if (badge && badge !== 'all') {
    query += ` AND l.badge_tier = ?`;
    params.push(badge);
  }

  if (search) {
    query += ` AND (
      l.title LIKE ? OR l.description LIKE ? OR l.tags LIKE ? OR IFNULL(l.tagline,'') LIKE ?
      OR l.asset_id LIKE ? OR l.listing_id LIKE ?
    )`;
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
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

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // Attach preview_url from hub_assets
    db.all("SELECT asset_id, preview_url, file_type FROM hub_assets", [], (err, assets) => {
      if (err) return res.status(500).json({ error: err.message });
      const assetMap = {};
      assets.forEach(a => assetMap[a.asset_id] = a);

      const enrichedRows = rows.map(item => ({
        ...item,
        preview_url: exchangePreviewUrl(
          item.asset_id,
          assetMap[item.asset_id]?.preview_url || PLACEHOLDER_PREVIEW,
        ),
        file_type: assetMap[item.asset_id]?.file_type || 'image'
      }));

      res.json(enrichedRows);
    });
  });
});

// Get single listing by ID with full creator passport and DNA summary
router.get('/:id', (req, res) => {
  const listingId = req.params.id;

  const query = `
    SELECT l.*, 
           COALESCE(u.name, 'Elena Rostova') as creator_name, 
           COALESCE(u.exchange_id, 'PX-772091') as creator_exchange_id, 
           COALESCE(u.bio, 'Award-winning provenance creator') as creator_bio, 
           COALESCE(u.kyc_status, 'verified') as kyc_status, 
           COALESCE(u.biometric_verified, 1) as biometric_verified,
           COALESCE(ha.preview_url, '') as cached_preview_url, 
           COALESCE(ha.file_type, 'image') as file_type, 
           COALESCE(ha.dna_record_id, 'DNA-9001-GOLD') as dna_record_id, 
           COALESCE(ha.vault_encrypted, 1) as vault_encrypted
    FROM listings l
    LEFT JOIN users u ON l.pinit_id = u.pinit_id
    LEFT JOIN hub_assets ha ON l.asset_id = ha.asset_id
    WHERE l.listing_id = ?
  `;

  db.get(query, [listingId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Listing not found' });
    row.preview_url = exchangePreviewUrl(row.asset_id, row.cached_preview_url || PLACEHOLDER_PREVIEW);
    delete row.cached_preview_url;

    // Increment view count
    db.run("UPDATE listings SET views = views + 1 WHERE listing_id = ?", [listingId]);

    res.json(row);
  });
});

/** Accept Hub list-intent JWT and prepare asset for listing modal */
router.post('/from-hub', (req, res) => {
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
});

// Create / Publish Listing from Hub to Exchange (WITH MANDATORY SECTION 9 AI POLICY CHECK)
router.post('/', (req, res) => {
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
  const sellerPinitId = pinit_id || 'PINIT-90481234';

  if (!asset_id) {
    return res.status(400).json({ error: "asset_id is required from Pinit HUB Vault" });
  }

  // Ensure seller user exists in SQLite
  db.run(`
    INSERT OR IGNORE INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan, bio)
    VALUES (?, ?, 'Elena Rostova', 'elena.rostova@pinit.io', 'creator', 'verified', 1, 'pro', 'Verified Provenance Creator')
  `, [sellerPinitId, 'PX-' + Math.floor(100000 + Math.random() * 900000)]);

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

      const prot = String(hubAsset.protection_status || 'protected').toLowerCase();
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

    const listingId = 'L-' + Math.floor(10000 + Math.random() * 90000);
    const dnaHash = '0x' + Array.from({length: 32}, () => Math.floor(Math.random()*16).toString(16)).join('');

    db.run(`
      INSERT INTO listings (
        listing_id, asset_id, pinit_id, title, description, tagline, vertical, tags,
        price_personal, price_commercial, price_exclusive, price_enterprise,
        ai_training_opt_out, status, badge_tier, human_percent, ai_percent, dna_hash, views, saves
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
    `, [
      listingId, asset_id, sellerPinitId, assetTitle, description || '',
      (tagline && String(tagline).trim()) || '',
      assetVertical,
      tags || 'pinit,verified', price_personal || 49, price_commercial || 149, price_exclusive || 899, price_enterprise || 2499,
      ai_training_opt_out ? 1 : 0, LISTING_STATUS.PUBLISHED, badgeTier, effectiveHumanPercent, effectiveAiPercent, dnaHash
    ], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      db.get("SELECT l.*, COALESCE(u.name, 'Elena Rostova') as creator_name FROM listings l LEFT JOIN users u ON l.pinit_id = u.pinit_id WHERE l.listing_id = ?", [listingId], async (err, newListing) => {
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
          message: "Listing published successfully to Pinit Exchange",
          listing: {
            ...newListing,
            preview_url: exchangePreviewUrl(asset_id, hubAsset?.preview_url || PLACEHOLDER_PREVIEW),
          },
          badge_assigned: badgeTier,
          hub_confirm: hubConfirm,
        });
      });
    });
    });
  });
  }
});

/** POST /api/listings/:id/status — seller lifecycle transitions */
router.post('/:id/status', async (req, res) => {
  try {
    const listingId = req.params.id;
    const sellerId = String(req.body?.pinit_id || '').trim();
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
    if (row.pinit_id !== sellerId) return res.status(403).json({ error: 'Only the seller can change listing status' });
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
router.patch('/:id', (req, res) => {
  const listingId = req.params.id;
  const sellerId = String(req.body?.pinit_id || '').trim();
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
