/**
 * Profile photos — vault-files/avatars/{userId}/
 * Bucket is private; the Hub public avatar route mints a signed URL.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseNodeClient } from './supabase-node';
import { logger } from './logger';
import { config } from '../config';

const BUCKET = 'vault-files';
const SIGNED_TTL_SEC = 60 * 60 * 24 * 7;

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env['SUPABASE_URL'] ?? '';
  const key = process.env['SUPABASE_SERVICE_KEY']?.trim()
    || process.env['SUPABASE_ANON_KEY']?.trim()
    || '';
  if (!url || !key) {
    throw new Error('Supabase storage not configured for avatars');
  }
  _client = createSupabaseNodeClient(url, key);
  return _client;
}

export function isAvatarStorageConfigured(): boolean {
  const url = process.env['SUPABASE_URL']?.trim() ?? '';
  const key = process.env['SUPABASE_SERVICE_KEY']?.trim()
    || process.env['SUPABASE_ANON_KEY']?.trim()
    || '';
  return Boolean(url && key);
}

export function extractAvatarPath(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const value = stored.trim();
  if (value.startsWith('avatars/')) return value.split('?')[0] ?? value;

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

export async function resolveAvatarSignedUrl(stored: string | null | undefined): Promise<string | null> {
  const path = extractAvatarPath(stored);
  if (!path) return stored?.startsWith('http') ? stored : null;

  try {
    const { data, error } = await getClient().storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL_SEC);
    if (error || !data?.signedUrl) {
      logger.warn('[Avatar] Signed URL failed', { path, error: error?.message });
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    logger.warn('[Avatar] Signed URL error', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function uploadAvatar(
  userId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const path = `avatars/${userId}/avatar.${ext}`;
  const { error } = await getClient().storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(`Avatar upload failed: ${error.message}`);
  logger.info('[Avatar] Uploaded', { userId, path });
  return path;
}

export function publicApiOrigin(): string {
  return (
    process.env['PUBLIC_API_ORIGIN']
    || process.env['RENDER_EXTERNAL_URL']
    || `http://localhost:${config.port}`
  ).replace(/\/$/, '');
}

/** Stable Hub URL the public portfolio can load without an expiring signed token. */
export function publicAvatarUrl(shortId: string, cacheBust?: string | number): string {
  const url = `${publicApiOrigin()}${config.apiPrefix}/profile/avatar/${encodeURIComponent(shortId)}`;
  return cacheBust != null && cacheBust !== '' ? `${url}?v=${cacheBust}` : url;
}

export function displayAvatarUrl(shortId: string, stored: string | null | undefined): string {
  if (!stored?.trim()) return '';
  if (/^https?:\/\//i.test(stored) && !extractAvatarPath(stored) && !stored.includes('/profile/avatar/')) {
    return stored.trim();
  }
  return publicAvatarUrl(shortId);
}
