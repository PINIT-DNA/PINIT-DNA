/**
 * COLLABORATION PHASE 1 — asset_versions (immutable revision chain).
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Creates one new table and one new enum, both guarded
 *   - DROPS / RENAMES / DELETES nothing
 *   - Touches no column on any existing table
 *   - Backfills nothing: versions are adopted lazily by
 *     assetVersionService.ensureV1() when an asset is first opened, so no mass
 *     UPDATE ever runs against production data
 *
 * Why this exists alongside prisma/migrations/20260825100000_asset_versions:
 * production boots via `npm run start:prod`, which runs this ensure-* chain and
 * does NOT run `prisma migrate deploy` (see docs/DATABASE_MIGRATIONS.md). The
 * migration file is the reviewable source of truth in git; this script is what
 * actually applies it in production. The two contain the same DDL.
 *
 * Does NOT touch: biometric, face, voice, PAD, WebAuthn, DNA engine, Vault,
 * auth, tenant isolation, listings, checkout, payments, delivery, sharing.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-asset-versions]', ...a);

// --- 1. Enum ----------------------------------------------------------------
// CREATE TYPE has no IF NOT EXISTS, so it is guarded by catching duplicate_object.
const ENUM_DDL = `
DO $$ BEGIN
    CREATE TYPE "ReviewStatus" AS ENUM (
        'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED',
        'IN_PROGRESS', 'APPROVED', 'SUPERSEDED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

// --- 2. Table + indexes -----------------------------------------------------
const DDL = [
  `CREATE TABLE IF NOT EXISTS "asset_versions" (
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
   )`,
  // One version number per asset — also the guard against a double-submit
  // registering V2 twice.
  `CREATE UNIQUE INDEX IF NOT EXISTS "asset_versions_assetId_versionNumber_key"
      ON "asset_versions"("assetId", "versionNumber")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "asset_versions_supersededById_key"
      ON "asset_versions"("supersededById")`,
  `CREATE INDEX IF NOT EXISTS "asset_versions_assetId_versionNumber_idx"
      ON "asset_versions"("assetId", "versionNumber")`,
  `CREATE INDEX IF NOT EXISTS "asset_versions_campaignId_reviewStatus_idx"
      ON "asset_versions"("campaignId", "reviewStatus")`,
  `CREATE INDEX IF NOT EXISTS "asset_versions_organizationId_idx"
      ON "asset_versions"("organizationId")`,
  `CREATE INDEX IF NOT EXISTS "asset_versions_dnaRecordId_idx"
      ON "asset_versions"("dnaRecordId")`,
  `CREATE INDEX IF NOT EXISTS "asset_versions_vaultId_idx"
      ON "asset_versions"("vaultId")`,
];

const FK_DDL = `
DO $$ BEGIN
    ALTER TABLE "asset_versions"
        ADD CONSTRAINT "asset_versions_assetId_fkey"
        FOREIGN KEY ("assetId") REFERENCES "assets"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

(async () => {
  try {
    await prisma.$executeRawUnsafe(ENUM_DDL);
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(FK_DDL);

    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int n FROM "asset_versions"`,
    );
    log(`ok — asset_versions present (${n} version${n === 1 ? '' : 's'} recorded)`);
  } catch (err) {
    // Never block boot: the app runs fine without the collaboration tables, and
    // a hard exit here would take the whole API down over a feature table.
    log('WARNING — could not ensure asset_versions:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
