/**
 * Exchange -> Hub asset activity emitter (Phase 2).
 *
 * Marketplace actions are recorded on Hub's canonical `AssetTimelineEvent`,
 * keyed on `Asset.id`. Exchange never invents an asset key: it resolves the
 * listing/order it already holds and sends whatever `asset_id` that row carries.
 *
 * Design rules:
 *  - Fire-and-forget. A failed audit call must never fail a cart update,
 *    a checkout, or a download. Every path swallows its own errors.
 *  - No PII. Buyer name, email, org, IP and device data are never sent; Hub
 *    scrubs again on receipt as defence in depth.
 *  - Nothing is derived from counters. An event is emitted only from the
 *    real action that just happened.
 */
import { hubApiBase, bridgeSecret } from './asset-activity-config.js';

/** Resolve a listing_id to its canonical Asset.id using the local listings row. */
export function resolveAssetIdForListing(db, listingId) {
  return new Promise((resolve) => {
    if (!listingId) return resolve(null);
    db.get('SELECT asset_id FROM listings WHERE listing_id = ?', [listingId], (err, row) => {
      if (err || !row) return resolve(null);
      resolve(row.asset_id || null);
    });
  });
}

/** Resolve a seal_id to its canonical Asset.id using the local sealed order. */
export function resolveAssetIdForSeal(db, sealId) {
  return new Promise((resolve) => {
    if (!sealId) return resolve(null);
    db.get('SELECT asset_id FROM orders_sealed WHERE seal_id = ?', [sealId], (err, row) => {
      if (err || !row) return resolve(null);
      resolve(row.asset_id || null);
    });
  });
}

/**
 * Post one or more events to Hub. Never throws.
 * @returns {Promise<{ok: boolean, skipped?: boolean}>}
 */
export async function postAssetActivity(events) {
  const list = (Array.isArray(events) ? events : [events]).filter((e) => e && e.assetId && e.eventType);
  if (list.length === 0) return { ok: false, skipped: true };

  const secret = bridgeSecret();
  if (!secret) {
    // Local dev without a bridge secret: stay silent rather than noisy.
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(`${hubApiBase()}/exchange/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PinIT-Bridge-Secret': secret },
      body: JSON.stringify({ events: list }),
    });
    if (!res.ok) {
      console.warn(`[asset-activity] Hub rejected activity (${res.status})`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[asset-activity] emit failed (non-fatal):', err.message);
    return { ok: false };
  }
}

/**
 * Convenience: resolve a listing to its asset and emit one event.
 * Deliberately not awaited by callers on the request path.
 */
export async function emitForListing(db, listingId, event) {
  try {
    const assetId = await resolveAssetIdForListing(db, listingId);
    if (!assetId) return { ok: false, skipped: true };
    return await postAssetActivity({ ...event, assetId });
  } catch (err) {
    console.warn('[asset-activity] emitForListing failed (non-fatal):', err.message);
    return { ok: false };
  }
}

/** Convenience: resolve a sealed order to its asset and emit one event. */
export async function emitForSeal(db, sealId, event) {
  try {
    const assetId = await resolveAssetIdForSeal(db, sealId);
    if (!assetId) return { ok: false, skipped: true };
    return await postAssetActivity({ ...event, assetId });
  } catch (err) {
    console.warn('[asset-activity] emitForSeal failed (non-fatal):', err.message);
    return { ok: false };
  }
}
