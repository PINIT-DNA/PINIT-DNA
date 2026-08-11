import { randomUUID } from 'crypto';
import { getSql, runSql, allSql } from './db.js';
import { BRIDGE_EVENT } from './lifecycle.js';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 30_000;

/**
 * Record or reuse an idempotent Hub bridge event.
 * Same idempotency_key → returns existing row without side effects.
 */
export async function recordBridgeEvent({
  eventType,
  idempotencyKey,
  assetId = null,
  listingId = null,
  orderId = null,
  licenseId = null,
  payload = {},
}) {
  const key = String(idempotencyKey || '').trim();
  if (!key) throw new Error('idempotencyKey required');

  const existing = await getSql('SELECT * FROM hub_bridge_events WHERE idempotency_key = ?', [key]);
  if (existing) {
    return { event: existing, duplicate: true };
  }

  const id = `EVT-${randomUUID().slice(0, 10)}`;
  try {
    await runSql(
      `INSERT INTO hub_bridge_events (
        id, event_type, idempotency_key, asset_id, listing_id, order_id, license_id,
        payload_json, status, attempt_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP)`,
      [
        id,
        eventType,
        key,
        assetId,
        listingId,
        orderId,
        licenseId,
        JSON.stringify(payload || {}),
      ],
    );
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      const again = await getSql('SELECT * FROM hub_bridge_events WHERE idempotency_key = ?', [key]);
      return { event: again, duplicate: true };
    }
    throw err;
  }

  const event = await getSql('SELECT * FROM hub_bridge_events WHERE id = ?', [id]);
  return { event, duplicate: false };
}

export async function markBridgeEventProcessed(id, extra = {}) {
  await runSql(
    `UPDATE hub_bridge_events
     SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error = NULL,
         payload_json = COALESCE(?, payload_json)
     WHERE id = ?`,
    [extra.payloadJson || null, id],
  );
}

export async function markBridgeEventFailed(id, errorMessage) {
  const row = await getSql('SELECT attempt_count FROM hub_bridge_events WHERE id = ?', [id]);
  const attempts = Number(row?.attempt_count || 0) + 1;
  const nextMs = Math.min(BASE_DELAY_MS * 2 ** Math.min(attempts - 1, 4), 30 * 60_000);
  const nextRetry = attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + nextMs).toISOString();
  const status = attempts >= MAX_ATTEMPTS ? 'dead' : 'failed';
  await runSql(
    `UPDATE hub_bridge_events
     SET status = ?, attempt_count = ?, last_attempt_at = CURRENT_TIMESTAMP,
         next_retry_at = ?, error = ?
     WHERE id = ?`,
    [status, attempts, nextRetry, String(errorMessage || '').slice(0, 500), id],
  );
}

/** Bounded retry stub — processes due failed events once per call */
export async function retryDueBridgeEvents({ limit = 10, handler } = {}) {
  const due = await allSql(
    `SELECT * FROM hub_bridge_events
     WHERE status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= CURRENT_TIMESTAMP
     ORDER BY next_retry_at ASC LIMIT ?`,
    [limit],
  );
  const results = [];
  for (const ev of due) {
    try {
      if (typeof handler === 'function') await handler(ev);
      await markBridgeEventProcessed(ev.id);
      results.push({ id: ev.id, ok: true });
    } catch (err) {
      await markBridgeEventFailed(ev.id, err.message);
      results.push({ id: ev.id, ok: false, error: err.message });
    }
  }
  return results;
}

export { BRIDGE_EVENT, MAX_ATTEMPTS };
