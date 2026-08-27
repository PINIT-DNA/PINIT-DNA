-- TEAM — campaign-scoped invitations.
--
-- ADDITIVE ONLY. Two nullable columns and one index on the EXISTING
-- organization_invites table. No second invitation system: the token, expiry,
-- status, Pinit-ID binding and acceptance flow all stay exactly as they were.
--
-- An invite with no campaignId behaves precisely as before.
--
-- DROPS / RENAMES / DELETES nothing.

ALTER TABLE "organization_invites" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;
ALTER TABLE "organization_invites" ADD COLUMN IF NOT EXISTS "campaignRole" TEXT;

CREATE INDEX IF NOT EXISTS "organization_invites_campaignId_status_idx"
  ON "organization_invites"("campaignId", "status");
