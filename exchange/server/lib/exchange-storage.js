/**
 * Marketplace-safe Supabase Storage for Exchange only.
 * Never touches Hub vault-files bucket.
 */
import { createClient } from '@supabase/supabase-js';

export const EXCHANGE_PREVIEW_BUCKET = 'exchange-previews';
export const EXCHANGE_DELIVERY_BUCKET = 'exchange-deliveries';

let client = null;

function getEnv(name) {
  return String(process.env[name] || '').trim();
}

/** Server client — uses anon key for public preview reads; optional service key for uploads. */
export function getExchangeSupabase() {
  if (client) return client;
  const url = getEnv('EXCHANGE_SUPABASE_URL') || getEnv('SUPABASE_URL');
  const key =
    getEnv('EXCHANGE_SUPABASE_SERVICE_KEY') ||
    getEnv('EXCHANGE_SUPABASE_ANON_KEY') ||
    getEnv('SUPABASE_ANON_KEY');
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function exchangeStorageConfigured() {
  return Boolean(getExchangeSupabase());
}

/**
 * Ensure Exchange buckets exist (idempotent). Requires a key that can create buckets
 * (often service role). Safe no-op if client missing or create fails.
 */
export async function ensureExchangeBuckets() {
  const sb = getExchangeSupabase();
  if (!sb) return { ok: false, reason: 'supabase_not_configured' };

  const results = [];
  for (const [id, isPublic] of [
    [EXCHANGE_PREVIEW_BUCKET, true],
    [EXCHANGE_DELIVERY_BUCKET, false],
  ]) {
    const { error } = await sb.storage.createBucket(id, { public: isPublic });
    if (error && !/already exists|duplicate/i.test(error.message)) {
      results.push({ bucket: id, ok: false, error: error.message });
    } else {
      results.push({ bucket: id, ok: true });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

/** Public URL for an object in exchange-previews (bucket is public). */
export function publicPreviewUrl(objectPath) {
  const url = getEnv('EXCHANGE_SUPABASE_URL') || getEnv('SUPABASE_URL');
  if (!url || !objectPath) return null;
  const base = url.replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${EXCHANGE_PREVIEW_BUCKET}/${objectPath.replace(/^\//, '')}`;
}

/**
 * Upload marketplace-safe preview bytes. Path convention: sellers/{pinitId}/{assetId}.{ext}
 * Does NOT upload Hub master vault files.
 */
export async function uploadExchangePreview(objectPath, buffer, contentType) {
  const sb = getExchangeSupabase();
  if (!sb) throw new Error('Exchange Supabase storage not configured');
  const { error } = await sb.storage.from(EXCHANGE_PREVIEW_BUCKET).upload(objectPath, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return publicPreviewUrl(objectPath);
}

/**
 * Stage a short-lived delivery object. Prefer Hub delivery prepare/redeem for masters.
 * Returns a signed URL (default 1 hour).
 */
export async function createSignedDeliveryUrl(objectPath, expiresSec = 3600) {
  const sb = getExchangeSupabase();
  if (!sb) throw new Error('Exchange Supabase storage not configured');
  const { data, error } = await sb.storage
    .from(EXCHANGE_DELIVERY_BUCKET)
    .createSignedUrl(objectPath, expiresSec);
  if (error) throw new Error(error.message);
  return data?.signedUrl || null;
}

export async function uploadExchangeDelivery(objectPath, buffer, contentType) {
  const sb = getExchangeSupabase();
  if (!sb) throw new Error('Exchange Supabase storage not configured');
  const { error } = await sb.storage.from(EXCHANGE_DELIVERY_BUCKET).upload(objectPath, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return objectPath;
}
