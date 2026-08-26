-- =============================================================================
-- COLLABORATION PHASE 5: scoped access for campaign people
--
-- ADDITIVE ONLY. Adds columns to campaign_members, one enum, one join table.
--   * DROPS nothing, RENAMES nothing, DELETES no data
--   * accessStatus defaults to NONE, so every person already listed on a
--     campaign keeps exactly the access they have today: none. Being on the
--     record has never been a grant and still is not.
--
-- No new access system: an external person's access is delivered as a scoped
-- ShareLink per assigned asset, so expiry, revocation, tracking, watermarking
-- and OTP all come from the existing secure-link machinery.
--
-- Paired with scripts/ensure-campaign-people-access.cjs.
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE "MemberAccessStatus" AS ENUM ('NONE', 'INVITED', 'ACTIVE', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "updatedAt"         TIMESTAMP(3);
ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "email"             TEXT;
ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "accessStatus"      "MemberAccessStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "canComment"        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "canRequestChanges" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "canApprove"        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "shareRecipientId"  TEXT;
ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "lastAccessAt"      TIMESTAMP(3);
ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "revokedAt"         TIMESTAMP(3);

-- Backfill updatedAt for rows that predate it, then make it required so Prisma
-- and the database agree. Uses createdAt rather than now(), so an existing row
-- does not claim to have been edited just because this migration ran.
UPDATE "campaign_members" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "campaign_members" ALTER COLUMN "updatedAt" SET NOT NULL;
-- No database default: Prisma's @updatedAt is application-managed, and a DB
-- default here shows as schema drift on every subsequent migrate diff.
ALTER TABLE "campaign_members" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "campaign_member_assets" (
    "id"         TEXT         NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memberId"   TEXT         NOT NULL,
    "assetId"    TEXT         NOT NULL,
    "shareToken" TEXT,
    CONSTRAINT "campaign_member_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_member_assets_memberId_assetId_key"
    ON "campaign_member_assets"("memberId", "assetId");
CREATE INDEX IF NOT EXISTS "campaign_member_assets_memberId_idx" ON "campaign_member_assets"("memberId");
CREATE INDEX IF NOT EXISTS "campaign_member_assets_assetId_idx"  ON "campaign_member_assets"("assetId");

DO $$ BEGIN
    ALTER TABLE "campaign_member_assets"
        ADD CONSTRAINT "campaign_member_assets_memberId_fkey"
        FOREIGN KEY ("memberId") REFERENCES "campaign_members"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
