-- Supabase Storage buckets for Pinit Exchange (same project as Hub).
-- DO NOT modify Hub bucket: vault-files
--
-- Create buckets in Dashboard (Storage) or via service API:
--   1) exchange-previews   — marketplace-safe thumbnails / preview media (public read OK for public objects)
--   2) exchange-deliveries — short-lived licensed delivery objects (private; signed URLs only)
--
-- Apply storage policies in Supabase SQL Editor (storage.objects).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('exchange-previews', 'exchange-previews', true, 52428800, NULL),
  ('exchange-deliveries', 'exchange-deliveries', false, 524288000, NULL)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public;

-- Public read for marketplace previews only
DROP POLICY IF EXISTS exchange_previews_public_read ON storage.objects;
CREATE POLICY exchange_previews_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'exchange-previews');

-- Authenticated/service uploads to previews (tighten with path prefix seller/{pinit_id}/ in app)
DROP POLICY IF EXISTS exchange_previews_service_write ON storage.objects;
CREATE POLICY exchange_previews_service_write ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'exchange-previews');

DROP POLICY IF EXISTS exchange_previews_service_update ON storage.objects;
CREATE POLICY exchange_previews_service_update ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'exchange-previews');

-- Deliveries: no public SELECT. Reads via signed URL (bypasses RLS) after Exchange license auth.
DROP POLICY IF EXISTS exchange_deliveries_no_public_select ON storage.objects;
CREATE POLICY exchange_deliveries_no_public_select ON storage.objects
  FOR SELECT
  USING (bucket_id = 'exchange-deliveries' AND false);

DROP POLICY IF EXISTS exchange_deliveries_service_insert ON storage.objects;
CREATE POLICY exchange_deliveries_service_insert ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'exchange-deliveries');

-- Explicit deny: Exchange policies never grant access to Hub vault-files
-- (Hub policies remain the only path for vault-files.)
