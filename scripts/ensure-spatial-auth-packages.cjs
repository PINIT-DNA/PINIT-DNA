/**
 * Spatial / pixel auth — one package per DNA record (no per-pixel rows).
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Creates spatial_auth_packages if missing
 *   - Adds 8×8 HKCA (pixel*) and 1×1 (pixel1*) columns if missing
 *   - DROPS / RENAMES / DELETES nothing
 *
 * Paired with:
 *   prisma/migrations/20260811140000_spatial_auth_phase1
 *   prisma/migrations/20260811150000_spatial_pixel_auth_phase3a
 *   prisma/migrations/20260820120000_phase1_asset_linkage (pixel1 columns)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-spatial-auth-packages]', ...a);

const DDL = [
  `CREATE TABLE IF NOT EXISTS "spatial_auth_packages" (
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
  )`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixelAlgoVersion" TEXT`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixelScheme" TEXT`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixelKeyId" TEXT`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixelCellSize" INTEGER`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixelTagBytes" INTEGER`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixelAuthBlob" BYTEA`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixelAuthRoot" CHAR(64)`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixelRootMac" CHAR(64)`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixel1AlgoVersion" TEXT`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixel1KeyId" TEXT`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixel1TagBytes" INTEGER`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixel1AuthBlob" BYTEA`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixel1AuthRoot" CHAR(64)`,
  `ALTER TABLE "spatial_auth_packages" ADD COLUMN IF NOT EXISTS "pixel1RootMac" CHAR(64)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "spatial_auth_packages_dnaRecordId_key" ON "spatial_auth_packages"("dnaRecordId")`,
  `CREATE INDEX IF NOT EXISTS "spatial_auth_packages_ownerUserId_idx" ON "spatial_auth_packages"("ownerUserId")`,
];

const FKS = [
  `DO $$ BEGIN
    ALTER TABLE "spatial_auth_packages"
      ADD CONSTRAINT "spatial_auth_packages_dnaRecordId_fkey"
      FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "spatial_auth_packages"
      ADD CONSTRAINT "spatial_auth_packages_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
];

(async () => {
  try {
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    for (const sql of FKS) await prisma.$executeRawUnsafe(sql);
    const cols = await prisma.$queryRawUnsafe(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'spatial_auth_packages'
        ORDER BY ordinal_position`,
    );
    const names = cols.map((c) => c.column_name);
    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int n FROM "spatial_auth_packages"`,
    );
    log(`ok — table present (${names.length} columns, ${n} package${n === 1 ? '' : 's'})`);
    log('columns:', names.join(', '));
  } catch (err) {
    log('WARNING — could not ensure spatial_auth_packages:', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
