-- =============================================================================
-- COLLABORATION PHASE 1: AssetVersion — the version chain for a deliverable
--
-- ADDITIVE ONLY. This migration:
--   * DROPS nothing
--   * RENAMES nothing
--   * DELETES no data
--   * Adds one new table and one new enum
--   * Touches no existing column on any existing table
--
-- Explicitly NOT touched: assets, dna_records, vault_records, certificates,
-- campaigns, clients, share_links, biometric/face/voice, auth, tenant isolation.
--
-- Written by hand and applied with `prisma db execute` rather than
-- `prisma migrate dev`, because this database carries pre-existing drift:
-- clients / campaigns / campaign_members were created via `db push` and appear
-- in no migration. `migrate dev` would detect that drift and offer to RESET the
-- database. Every statement below is guarded so re-running is a no-op.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ReviewStatus enum
--
-- Separate from AssetStatus by design: AssetStatus is a protection/monitoring
-- lifecycle (PROTECTED, MONITORING, DISCOVERY). Review is a different axis and
-- overloading one enum with both would make "protected" and "approved"
-- indistinguishable.
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "ReviewStatus" AS ENUM (
        'DRAFT',
        'IN_REVIEW',
        'CHANGES_REQUESTED',
        'IN_PROGRESS',
        'APPROVED',
        'SUPERSEDED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 2. asset_versions
--
-- Each row owns its own dnaRecordId / vaultId / certificateId. A new version is
-- an INSERT; nothing rewrites a prior row's protection columns. That is what
-- makes prior versions immutable at the storage layer rather than by convention.
--
-- The FK to assets uses ON DELETE CASCADE only so that deleting an asset does
-- not strand orphan versions. No cascade runs in the other direction.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "asset_versions" (
    "id"               TEXT         NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    "assetId"          TEXT         NOT NULL,
    "versionNumber"    INTEGER      NOT NULL,
    "organizationId"   TEXT         NOT NULL,
    "campaignId"       TEXT,

    "dnaRecordId"      TEXT,
    "vaultId"          TEXT,
    "certificateId"    TEXT,
    "contentHash"      TEXT,
    "originalFilename" TEXT         NOT NULL,
    "mimeType"         TEXT         NOT NULL DEFAULT 'application/octet-stream',
    "sizeBytes"        INTEGER      NOT NULL DEFAULT 0,

    "reviewStatus"     "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "changeSummary"    TEXT,
    "createdByUserId"  TEXT         NOT NULL,

    "supersededAt"     TIMESTAMP(3),
    "supersededById"   TEXT,

    CONSTRAINT "asset_versions_pkey" PRIMARY KEY ("id")
);

-- One version number per asset — the guard against a double-submit creating V2 twice.
CREATE UNIQUE INDEX IF NOT EXISTS "asset_versions_assetId_versionNumber_key"
    ON "asset_versions"("assetId", "versionNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "asset_versions_supersededById_key"
    ON "asset_versions"("supersededById");

CREATE INDEX IF NOT EXISTS "asset_versions_assetId_versionNumber_idx"
    ON "asset_versions"("assetId", "versionNumber");
CREATE INDEX IF NOT EXISTS "asset_versions_campaignId_reviewStatus_idx"
    ON "asset_versions"("campaignId", "reviewStatus");
CREATE INDEX IF NOT EXISTS "asset_versions_organizationId_idx"
    ON "asset_versions"("organizationId");
CREATE INDEX IF NOT EXISTS "asset_versions_dnaRecordId_idx"
    ON "asset_versions"("dnaRecordId");
CREATE INDEX IF NOT EXISTS "asset_versions_vaultId_idx"
    ON "asset_versions"("vaultId");

DO $$ BEGIN
    ALTER TABLE "asset_versions"
        ADD CONSTRAINT "asset_versions_assetId_fkey"
        FOREIGN KEY ("assetId") REFERENCES "assets"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
