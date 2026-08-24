/**
 * PHASE 1 — Canonical Asset.id linkage + spatial_auth_packages reconciliation.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Adds only NULLABLE columns (existing INSERTs keep working)
 *   - DROPS / RENAMES / DELETES nothing
 *   - Backfills only where a join deterministically proves the mapping
 *   - Reports unmatched rows instead of guessing them
 *
 * Does NOT touch: biometric, face, voice, PAD, WebAuthn, DNA engine, Vault,
 * auth, tenant isolation, listings, checkout, payments, delivery, sharing.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-asset-linkage]', ...a);

// --- 1. Additive DDL --------------------------------------------------------
const DDL = [
  `ALTER TABLE "certificates"    ADD COLUMN IF NOT EXISTS "assetId" TEXT`,
  `ALTER TABLE "monitor_records" ADD COLUMN IF NOT EXISTS "assetId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "certificates_assetId_idx"    ON "certificates"("assetId")`,
  `CREATE INDEX IF NOT EXISTS "monitor_records_assetId_idx" ON "monitor_records"("assetId")`,
];

// Enum values for commerce provenance. ADD VALUE IF NOT EXISTS cannot run inside
// an explicit transaction on some PG versions, so each is issued standalone.
const ENUM_VALUES = [
  'PAID', 'DELIVERED', 'DOWNLOADED', 'REVIEWED', 'REFUNDED',
  'VIEWED', 'LIKED', 'WISHLIST_ADDED', 'WISHLIST_REMOVED', 'CART_ADDED', 'CART_REMOVED', 'LISTING_UPDATED', 'PRICE_CHANGED', 'LICENSE_CREATED', 'DISPUTED',
];

// --- 2. Deterministic backfill ---------------------------------------------
// Guarded by "assetId" IS NULL so re-runs are no-ops and manual corrections
// are never overwritten.
const BACKFILL = [
  {
    label: 'certificates.assetId  (via vaultId)',
    sql: `UPDATE "certificates" c SET "assetId" = a."id"
            FROM "assets" a
           WHERE a."vaultId" = c."vaultId" AND c."assetId" IS NULL`,
    unmatched: `SELECT COUNT(*)::int n FROM "certificates" WHERE "assetId" IS NULL`,
  },
  {
    label: 'monitor_records.assetId (via dnaRecordId)',
    sql: `UPDATE "monitor_records" m SET "assetId" = a."id"
            FROM "assets" a
           WHERE a."dnaId" = m."dnaRecordId" AND m."assetId" IS NULL`,
    unmatched: `SELECT COUNT(*)::int n FROM "monitor_records" WHERE "assetId" IS NULL`,
  },
];

// A vaultId/dnaId mapping to more than one asset would make the backfill
// ambiguous. Abort rather than write a guess.
const AMBIGUITY_GUARDS = [
  { label: 'vaultId -> >1 asset', sql: `SELECT COUNT(*)::int n FROM (SELECT "vaultId" FROM "assets" WHERE "vaultId" IS NOT NULL GROUP BY "vaultId" HAVING COUNT(*) > 1) x` },
  { label: 'dnaId -> >1 asset',   sql: `SELECT COUNT(*)::int n FROM (SELECT "dnaId"   FROM "assets" WHERE "dnaId"   IS NOT NULL GROUP BY "dnaId"   HAVING COUNT(*) > 1) x` },
];

async function main() {
  for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
  log('additive DDL applied');

  for (const v of ENUM_VALUES) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TYPE "AssetTimelineType" ADD VALUE IF NOT EXISTS '${v}'`);
    } catch (err) {
      log(`enum value ${v} skipped:`, err.message || err);
    }
  }
  log('timeline enum values ensured');

  for (const g of AMBIGUITY_GUARDS) {
    const [{ n }] = await prisma.$queryRawUnsafe(g.sql);
    if (n > 0) {
      log(`ABORT: ambiguous mapping (${g.label}) affects ${n} group(s). Backfill skipped.`);
      return;
    }
  }

  for (const b of BACKFILL) {
    const updated = await prisma.$executeRawUnsafe(b.sql);
    const [{ n }] = await prisma.$queryRawUnsafe(b.unmatched);
    log(`${b.label}: ${updated} row(s) backfilled, ${n} left NULL (unprovable)`);
  }
}

main()
  .catch((err) => {
    // Never block boot on an audit-linkage failure.
    console.warn('[ensure-asset-linkage] skipped:', err.message || err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
