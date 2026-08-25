-- =============================================================================
-- COLLABORATION PHASE 2b: review mode on a share link
--
-- ADDITIVE ONLY. Adds four columns to share_links; drops and renames nothing.
--
-- Every column defaults to the current behaviour (review off), so all 12
-- existing share links keep working exactly as they do today and no client
-- suddenly gains the ability to comment on something.
--
-- Paired with scripts/ensure-share-link-review.cjs — see
-- docs/DATABASE_MIGRATIONS.md.
-- =============================================================================
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "reviewMode"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "allowComments"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "allowChangeRequest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "reviewVersionId"    TEXT;

CREATE INDEX IF NOT EXISTS "share_links_reviewVersionId_idx"
    ON "share_links"("reviewVersionId");
