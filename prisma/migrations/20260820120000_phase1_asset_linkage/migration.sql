-- =============================================================================
-- PHASE 1: Canonical Asset.id linkage + spatial_auth_packages drift reconciliation
--
-- ADDITIVE ONLY. This migration:
--   * DROPS nothing
--   * RENAMES nothing
--   * DELETES no data
--   * Adds only NULLABLE columns, so every existing INSERT keeps working
--
-- Explicitly NOT touched: biometric, face, voice, PAD, WebAuthn, DNA engine,
-- Vault, auth middleware, tenant isolation, listings, checkout, payments,
-- delivery, sharing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. spatial_auth_packages — reconciliation, NOT creation.
--
-- This table already exists in production (30 columns, 2 FKs, 0 rows) but was
-- created outside the migration history (via `prisma db push` or manual DDL),
-- which is why `prisma migrate` kept proposing to DROP it.
--
-- The guard below makes this a NO-OP on production while ensuring a database
-- rebuilt from migration history matches production exactly.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "spatial_auth_packages" (
    "id"                TEXT         NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    "dnaRecordId"       TEXT         NOT NULL,
    "ownerUserId"       TEXT         NOT NULL,
    "width"             INTEGER      NOT NULL,
    "height"            INTEGER      NOT NULL,
    "orientationPolicy" TEXT         NOT NULL DEFAULT 'file-pixel-order-v1',
    "globalDnaRef"      TEXT         NOT NULL,
    "keyId"             TEXT         NOT NULL,
    "algorithmVersion"  TEXT         NOT NULL,
    "primaryScale"      INTEGER      NOT NULL,
    "scales"            INTEGER[],
    "merkleRoot"        CHAR(64)     NOT NULL,
    "rootMac"           CHAR(64)     NOT NULL,
    "blockBlob"         BYTEA        NOT NULL,
    "pixelAlgoVersion"  TEXT,
    "pixelScheme"       TEXT,
    "pixelKeyId"        TEXT,
    "pixelCellSize"     INTEGER,
    "pixelTagBytes"     INTEGER,
    "pixelAuthBlob"     BYTEA,
    "pixelAuthRoot"     CHAR(64),
    "pixelRootMac"      CHAR(64),
    "pixel1AlgoVersion" TEXT,
    "pixel1KeyId"       TEXT,
    "pixel1TagBytes"    INTEGER,
    "pixel1AuthBlob"    BYTEA,
    "pixel1AuthRoot"    CHAR(64),
    "pixel1RootMac"     CHAR(64),
    CONSTRAINT "spatial_auth_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "spatial_auth_packages_dnaRecordId_key"
    ON "spatial_auth_packages"("dnaRecordId");
CREATE INDEX IF NOT EXISTS "spatial_auth_packages_ownerUserId_idx"
    ON "spatial_auth_packages"("ownerUserId");

DO $$ BEGIN
    ALTER TABLE "spatial_auth_packages"
        ADD CONSTRAINT "spatial_auth_packages_dnaRecordId_fkey"
        FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "spatial_auth_packages"
        ADD CONSTRAINT "spatial_auth_packages_ownerUserId_fkey"
        FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 2. Canonical Asset.id linkage (nullable, no FK, no backfill here)
-- -----------------------------------------------------------------------------
ALTER TABLE "certificates"    ADD COLUMN IF NOT EXISTS "assetId" TEXT;
ALTER TABLE "monitor_records" ADD COLUMN IF NOT EXISTS "assetId" TEXT;

CREATE INDEX IF NOT EXISTS "certificates_assetId_idx"    ON "certificates"("assetId");
CREATE INDEX IF NOT EXISTS "monitor_records_assetId_idx" ON "monitor_records"("assetId");

-- -----------------------------------------------------------------------------
-- 3. AssetTimelineType — additive enum values for commerce provenance.
-- LISTED/SOLD/SHARED/SHARE_VIEWED/SHARE_DOWNLOADED already exist.
-- Postgres cannot remove enum values; unused values are inert.
-- -----------------------------------------------------------------------------
ALTER TYPE "AssetTimelineType" ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE "AssetTimelineType" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "AssetTimelineType" ADD VALUE IF NOT EXISTS 'DOWNLOADED';
ALTER TYPE "AssetTimelineType" ADD VALUE IF NOT EXISTS 'REVIEWED';
ALTER TYPE "AssetTimelineType" ADD VALUE IF NOT EXISTS 'REFUNDED';
