/**
 * Organization logo uploads — Supabase Storage bucket vault-files/org-logos/
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

const BUCKET = 'vault-files';

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
  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  logger.info('[OrgLogo] Uploaded', { organizationId, path });
  return data.publicUrl;
}

export function isOrgLogoStorageConfigured(): boolean {
  const url = process.env['SUPABASE_URL']?.trim() ?? '';
  const key = process.env['SUPABASE_SERVICE_KEY']?.trim()
    || process.env['SUPABASE_ANON_KEY']?.trim()
    || '';
  return Boolean(url && key);
}
