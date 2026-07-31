/**
 * Organization logo uploads — Supabase Storage bucket vault-files/org-logos/
 * Bucket is private; store object path in DB and mint signed URLs for the UI.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

const BUCKET = 'vault-files';
const SIGNED_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env['SUPABASE_URL'] ?? '';
  const key = process.env['SUPABASE_SERVICE_KEY']?.trim()
    || process.env['SUPABASE_ANON_KEY']?.trim()
    || '';
  if (!url || !key) {
    throw new Error('Supabase storage not configured for org logos');
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

/** Turn a stored path or legacy public URL into a vault-files object key. */
export function extractOrgLogoPath(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const value = stored.trim();
  if (value.startsWith('org-logos/')) return value.split('?')[0] ?? value;

  const publicMarker = `/object/public/${BUCKET}/`;
  const publicIdx = value.indexOf(publicMarker);
  if (publicIdx >= 0) {
    return decodeURIComponent(value.slice(publicIdx + publicMarker.length).split('?')[0] ?? '');
  }

  const signMarker = `/object/sign/${BUCKET}/`;
  const signIdx = value.indexOf(signMarker);
  if (signIdx >= 0) {
    return decodeURIComponent(value.slice(signIdx + signMarker.length).split('?')[0] ?? '');
  }

  return null;
}

/** Mint a temporary URL browsers can load (private bucket). */
export async function resolveOrgLogoUrl(stored: string | null | undefined): Promise<string | null> {
  const path = extractOrgLogoPath(stored);
  if (!path) return stored?.startsWith('http') ? stored : null;

  try {
    const { data, error } = await getClient().storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL_SEC);
    if (error || !data?.signedUrl) {
      logger.warn('[OrgLogo] Signed URL failed', { path, error: error?.message });
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    logger.warn('[OrgLogo] Signed URL error', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Upload logo bytes. Returns the storage object path (not a public URL).
 */
export async function uploadOrgLogo(
  organizationId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const path = `org-logos/${organizationId}/logo.${ext}`;
  const client = getClient();
  const { error } = await client.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(`Logo upload failed: ${error.message}`);
  logger.info('[OrgLogo] Uploaded', { organizationId, path });
  return path;
}

export function isOrgLogoStorageConfigured(): boolean {
  const url = process.env['SUPABASE_URL']?.trim() ?? '';
  const key = process.env['SUPABASE_SERVICE_KEY']?.trim()
    || process.env['SUPABASE_ANON_KEY']?.trim()
    || '';
  return Boolean(url && key);
}
