import express from 'express';
import multer from 'multer';
import db from '../database.js';
import {
  fetchListableAssetsFromHub,
  protectUploadWithHub,
  fetchMonitoringSummariesFromHub,
  fetchPreviewFromHub,
} from '../hub-client.js';
import { exchangePreviewUrl, isHubVaultId, PLACEHOLDER_PREVIEW } from '../lib/preview-url.js';
import { verifyPreviewToken } from '../lib/preview-token.js';
import { rateLimit } from '../lib/rate-limit.js';
import { requireSeller, requireActiveSeller } from '../lib/rbac.js';
import { identityCandidates, sellerMatchClause, listingUserJoinSql } from '../lib/pinit-identity.js';

const router = express.Router();

/**
 * Preview requests are cheap per call but decrypt a vault object on a cache
 * miss, so an unthrottled scraper is both a cost and a bulk-download vector.
 */
const previewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many preview requests. Slow down.',
});
const HUB_APP_URL = (process.env.HUB_APP_URL || 'http://localhost:3002').replace(/\/$/, '');

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.webp', '.tiff', '.tif', '.gif', '.bmp',
  '.heic', '.heif', '.avif', '.svg', '.ico', '.jxl', '.apng',
]);
const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.mov', '.qt', '.avi', '.mkv', '.webm', '.mpeg', '.mpg', '.mpe',
  '.3gp', '.3g2', '.ogv', '.ogg', '.flv', '.wmv', '.ts', '.mts', '.m2ts',
]);

function extOf(name = '') {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function isAllowedMedia(file) {
  const mime = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/')) return true;
  if (mime === 'application/octet-stream') {
    const ext = extOf(file.originalname);
    return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
  }
  const ext = extOf(file.originalname);
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMedia(file)) return cb(null, true);
    cb(new Error(`Unsupported media type "${file.mimetype}" (${file.originalname}). Use image or video files.`));
  },
});

function normalizeVertical(fileTypeOrVertical, fileName = '') {
  const raw = String(fileTypeOrVertical || '').toLowerCase().trim();
  if (raw === 'image' || raw === 'images' || raw === 'photography' || raw.startsWith('image/')) return 'images';
  if (raw === 'video' || raw.startsWith('video/')) return 'video';
  if (raw === 'audio' || raw.startsWith('audio/')) return 'audio';
  if (raw === 'ui_ux' || raw === 'ui' || raw === 'ux') return 'ui_ux';
  if (raw === '3d' || raw === 'model') return '3d';
  if (raw === 'documents' || raw === 'document' || raw === 'concepts' || raw === 'pdf') return 'concepts';
  const ext = extOf(fileName || raw);
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (IMAGE_EXTS.has(ext)) return 'images';
  if (!raw) return 'images';
  return raw;
}

function mapHubAsset(a, pinitId) {
  const nameHint = a.title || a.original_name || a.file_name || '';
  const fileType = normalizeVertical(a.file_type || a.vertical || a.mime_type, nameHint);
  const assetId = a.asset_id || a.vault_id;
  const proxyPreview = exchangePreviewUrl(assetId);
  return {
    asset_id: assetId,
    vault_id: a.vault_id || a.asset_id,
    pinit_id: pinitId,
    title: a.title || 'Protected Hub Asset',
    file_type: fileType,
    vertical: normalizeVertical(a.vertical || fileType, nameHint),
    preview_url: proxyPreview || a.preview_url || PLACEHOLDER_PREVIEW,
    preview_path: a.preview_path || null,
    vault_encrypted: a.vault_encrypted !== false ? 1 : 0,
    dna_record_id: a.dna_record_id || null,
    human_percent: a.human_percent != null ? Number(a.human_percent) : 90,
    ai_percent: a.ai_percent != null ? Number(a.ai_percent) : 10,
    badge_tier: a.badge_tier || 'Bronze',
    dna_status: a.dna_status || null,
    created_at: a.created_at || null,
    source: a.source || 'hub',
  };
}

function upsertLocalCache(asset, pinitId, cb) {
  const protectionStatus = asset.protection_status || 'protected';
  db.run(`
    INSERT INTO hub_assets (
      asset_id, pinit_id, title, file_type, vertical, preview_url,
      vault_encrypted, dna_record_id, human_percent, ai_percent, badge_tier, protection_status
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET
      title = excluded.title,
      human_percent = excluded.human_percent,
      ai_percent = excluded.ai_percent,
      badge_tier = excluded.badge_tier,
      dna_record_id = excluded.dna_record_id,
      protection_status = excluded.protection_status,
      preview_url = excluded.preview_url
  `, [
    asset.asset_id,
    pinitId,
    asset.title,
    asset.file_type,
    asset.vertical,
    asset.preview_url || exchangePreviewUrl(asset.asset_id) || PLACEHOLDER_PREVIEW,
    asset.dna_record_id || `DNA-${String(asset.asset_id).slice(0, 8)}`,
    asset.human_percent,
    asset.ai_percent,
    asset.badge_tier,
    protectionStatus,
  ], () => cb?.());
}

router.get('/assets', requireSeller, async (req, res) => {
  const pinitId = String(req.query.pinit_id || req.exchangeUser?.pinit_id || '').trim();
  if (!pinitId) {
    return res.status(400).json({
      error: 'pinit_id is required',
      hint: 'Sign in with Pinit HUB first, then list protected vault assets.',
      hub_url: HUB_APP_URL,
    });
  }

  const idsToTry = identityCandidates(pinitId);
  const tryIds = idsToTry.length ? idsToTry : [pinitId];

  try {
    let mapped = null;
    let skippedAll = true;
    for (const id of tryIds) {
      const live = await fetchListableAssetsFromHub(id);
      if (live.skipped) continue;
      skippedAll = false;
      if (Array.isArray(live.assets)) {
        mapped = live.assets.map((a) => mapHubAsset(a, live.pinitId || id));
        if (mapped.length) break;
      }
    }
    if (!skippedAll && Array.isArray(mapped)) {
      mapped.forEach((asset) => upsertLocalCache(asset, pinitId));
      return res.json({
        assets: mapped,
        source: 'hub',
        empty: mapped.length === 0,
        message: mapped.length
          ? undefined
          : 'No protected vault assets yet. Protect in Pinit HUB, then list from My Assets.',
        hub_protect_url: `${HUB_APP_URL}/generate`,
      });
    }
  } catch (err) {
    console.warn('[hub/assets] live Hub fetch failed, using local cache:', err.message);
  }

  const match = sellerMatchClause('pinit_id', pinitId);
  db.all(
    `SELECT * FROM hub_assets WHERE ${match.sql.replace(/^\s*AND\s+/i, '')} ORDER BY created_at DESC`,
    match.params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        assets: rows || [],
        source: 'cache',
        hub_protect_url: `${HUB_APP_URL}/generate`,
        message: rows?.length
          ? undefined
          : 'Connect Exchange to Hub (same EXCHANGE_BRIDGE_SECRET) or list an asset from your Hub vault.',
      });
    },
  );
});

router.post('/protect-upload', requireActiveSeller, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        error: err.message || 'Upload rejected',
        hub_protect_url: `${HUB_APP_URL}/generate`,
      });
    }
    try {
      const pinitId = String(req.body?.pinit_id || req.query.pinit_id || '').trim();
      if (!pinitId) {
        return res.status(400).json({ error: 'pinit_id is required (Hub-linked seller)' });
      }
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: 'file is required (multipart field: file)' });
      }

      // Pending marker (retry-safe): never publish from this state
      const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      upsertLocalCache({
        asset_id: pendingId,
        title: req.file.originalname,
        file_type: 'images',
        vertical: 'images',
        preview_url: PLACEHOLDER_PREVIEW,
        dna_record_id: `DNA-PENDING`,
        human_percent: 0,
        ai_percent: 0,
        badge_tier: 'Bronze',
        protection_status: 'protection_pending',
      }, pinitId);

      let assetRaw;
      try {
        assetRaw = await protectUploadWithHub({
          pinitId,
          fileBuffer: req.file.buffer,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
        });
      } catch (hubErr) {
        db.run(
          `UPDATE hub_assets SET protection_status = 'protection_failed', title = ? WHERE asset_id = ?`,
          [req.file.originalname, pendingId],
        );
        console.error('[hub/protect-upload]', hubErr.message);
        return res.status(hubErr.status || 502).json({
          error: hubErr.message || 'Silent Hub protect failed',
          protection_status: 'protection_failed',
          retryable: true,
          pending_asset_id: pendingId,
          hub_protect_url: `${HUB_APP_URL}/generate`,
        });
      }

      // Remove pending stub; store protected vault asset
      db.run('DELETE FROM hub_assets WHERE asset_id = ?', [pendingId]);
      const asset = mapHubAsset(
        {
          ...assetRaw,
          title: assetRaw.title || req.file.originalname,
          mime_type: req.file.mimetype,
          protection_status: 'protected',
        },
        assetRaw.pinit_id || pinitId,
      );
      asset.protection_status = 'protected';
      upsertLocalCache(asset, asset.pinit_id || pinitId);

      res.status(201).json({
        message: 'Protected in Pinit HUB. Ready to publish on Exchange.',
        asset,
        protection_status: 'protected',
        source: 'hub_silent_protect',
      });
    } catch (e) {
      console.error('[hub/protect-upload]', e.message);
      res.status(e.status || 500).json({
        error: e.message || 'Silent Hub protect failed',
        protection_status: 'protection_failed',
        hub_protect_url: `${HUB_APP_URL}/generate`,
      });
    }
  });
});

/** Stream Hub vault preview for marketplace (video/image playable in browser) */
router.get('/preview/:assetId', previewLimiter, async (req, res) => {
  const assetId = String(req.params.assetId || '').trim();
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  // The URL must carry a signature minted by this server. Without this, the
  // path is guessable from the public listings API, which returns asset_id in
  // plaintext — anyone could fetch, hotlink, or address-bar the preview.
  const signature = verifyPreviewToken(assetId, req.query.t, req.query.e);
  if (!signature.ok) {
    return res.status(403).json({ error: 'Preview link is invalid or has expired' });
  }

  // Only a PUBLISHED listing may be previewed.
  //
  // This previously read `Boolean(row) || isHubVaultId(assetId)`. isHubVaultId
  // only checks UUID *format*, so the `||` defeated the allow-list entirely:
  // any well-formed UUID passed, including assets belonging to other users
  // that were never listed on Exchange. Verified before the fix — anonymous
  // requests returned previews for two unlisted assets owned by a different
  // account.
  const allow = await new Promise((resolve) => {
    db.get(
      `SELECT l.asset_id
         FROM listings l
         INNER JOIN users u ON ${listingUserJoinSql('l', 'u')}
        WHERE l.asset_id = ?
          AND l.status IN ('published', 'live', 'sold_exclusive')
        LIMIT 1`,
      [assetId],
      (err, row) => resolve(Boolean(row)),
    );
  });
  if (!allow) return res.status(404).json({ error: 'Asset not found on Exchange' });

  try {
    const preview = await fetchPreviewFromHub(assetId);
    res.set({
      'Content-Type': preview.contentType,
      'Content-Length': String(preview.buffer.length),
      'Accept-Ranges': 'bytes',
      // Signed URLs expire, so a long-lived cached copy would outlive its
      // grant. no-store also stops a full-page save pulling it from cache.
      'Cache-Control': 'private, no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      // No filename — the original name is the creator's, not the viewer's.
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
    });
    // The app mounts a global cors() which emits `Access-Control-Allow-Origin: *`.
    // That is fine for JSON APIs but turns previews into hotlinkable assets any
    // site can embed, so it is stripped on this route specifically.
    res.removeHeader('Access-Control-Allow-Origin');
    res.status(200).send(preview.buffer);
  } catch (err) {
    console.error('[hub/preview]', err.message);
    res.status(err.status || 502).json({ error: err.message || 'Preview unavailable' });
  }
});

router.get('/monitoring-summaries', async (req, res) => {
  const pinitId = String(req.query.pinit_id || '').trim();
  if (!pinitId) return res.status(400).json({ error: 'pinit_id is required' });
  try {
    const data = await fetchMonitoringSummariesFromHub(pinitId);
    res.json({
      summaries: data.summaries || [],
      hub_app_url: HUB_APP_URL,
      message: 'Full investigations open in Pinit HUB only.',
    });
  } catch (err) {
    res.status(502).json({ error: err.message, summaries: [] });
  }
});

router.post('/protect', (_req, res) => {
  res.status(410).json({
    error: 'USE_PROTECT_UPLOAD',
    message: 'Upload via POST /api/hub/protect-upload — Hub silently protects, then you publish the listing.',
    hub_protect_url: `${HUB_APP_URL}/generate`,
  });
});

function listingWhere(match) {
  return `WHERE ${String(match.sql || '').replace(/^\s*AND\s+/i, '')}`;
}

function requireBridgeSecret(req, res, next) {
  const got = String(req.headers['x-pinit-bridge-secret'] || req.headers['x-exchange-bridge-secret'] || '').trim();
  const accepted = new Set(
    [
      process.env.EXCHANGE_BRIDGE_SECRET,
      process.env.HUB_BRIDGE_SECRET,
      process.env.JWT_SECRET,
    ].filter((s) => Boolean(s && String(s).trim())),
  );
  if (!got || !accepted.has(got)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

/** Hub My Assets — which vault/asset ids are currently listed for sale. */
router.get('/seller-listings', requireBridgeSecret, (req, res) => {
  const pinitId = String(req.query.pinitId || req.query.pinit_id || '').trim();
  if (!pinitId) return res.status(400).json({ error: 'pinitId is required' });

  const listingScope = sellerMatchClause('pinit_id', pinitId);
  db.all(
    `SELECT listing_id, asset_id, status FROM listings ${listingWhere(listingScope)}`,
    listingScope.params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const listings = (rows || [])
        .filter((row) => {
          const status = String(row.status || '').toLowerCase();
          return status === 'live' || status === 'published';
        })
        .map((row) => ({
          listing_id: row.listing_id,
          asset_id: row.asset_id,
          status: row.status,
        }));
      res.json({ listings });
    },
  );
});

/** Hub Home KPIs — metrics only, no buyer PII. */
router.get('/seller-desk', requireBridgeSecret, (req, res) => {
  const pinitId = String(req.query.pinitId || req.query.pinit_id || '').trim();
  if (!pinitId) return res.status(400).json({ error: 'pinitId is required' });

  const listingScope = sellerMatchClause('pinit_id', pinitId);
  const salesScope = sellerMatchClause('seller_pinit_id', pinitId);

  db.all(
    `SELECT status, views, saves FROM listings ${listingWhere(listingScope)}`,
    listingScope.params,
    (err, listings) => {
      if (err) return res.status(500).json({ error: err.message });
      db.all(
        `SELECT creator_net, price_paid FROM orders_sealed ${listingWhere(salesScope)}`,
        salesScope.params,
        (salesErr, sales) => {
          if (salesErr) return res.status(500).json({ error: salesErr.message });
          const rows = listings || [];
          const sealed = sales || [];
          const totalNet = sealed.reduce((acc, s) => acc + (Number(s.creator_net) || 0), 0);
          const live = rows.filter((l) => l.status === 'live' || l.status === 'published').length;
          res.json({
            metrics: {
              total_net_revenue: Math.round(totalNet * 100) / 100,
              sealed_sales_count: sealed.length,
              active_listings_count: live,
              listings_count: rows.length,
              total_views: rows.reduce((acc, l) => acc + (Number(l.views) || 0), 0),
              total_saves: rows.reduce((acc, l) => acc + (Number(l.saves) || 0), 0),
            },
          });
        },
      );
    },
  );
});

export default router;
