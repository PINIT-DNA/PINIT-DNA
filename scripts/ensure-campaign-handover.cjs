/**
 * COLLABORATION PHASE 6 — client handover.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Creates two tables and one enum
 *   - DROPS / RENAMES / DELETES nothing
 *   - Creates no licensing model: Exchange stays the source of truth and is
 *     read through its own schema, read-only
 *   - Touches no DNA record, vault record or certificate
 *
 * Paired with prisma/migrations/20260826180000_campaign_handover — production
 * boots through this chain, not `prisma migrate deploy`. See
 * docs/DATABASE_MIGRATIONS.md.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-campaign-handover]', ...a);

const ENUM_DDL = `DO $$ BEGIN
  CREATE TYPE "HandoverStatus" AS ENUM ('DRAFT','READY','COMPLETED','REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

const DDL = [
  `CREATE TABLE IF NOT EXISTS "campaign_handovers" (
      "id" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      "organizationId" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "clientId" TEXT,
      "status" "HandoverStatus" NOT NULL DEFAULT 'DRAFT',
      "title" TEXT,
      "note" TEXT,
      "recipientLabel" TEXT NOT NULL,
      "recipientEmail" TEXT,
      "shareRecipientId" TEXT,
      "accessToken" TEXT NOT NULL,
      "expiresAt" TIMESTAMP(3),
      "sentAt" TIMESTAMP(3),
      "firstOpenedAt" TIMESTAMP(3),
      "completedAt" TIMESTAMP(3),
      "revokedAt" TIMESTAMP(3),
      "openCount" INTEGER NOT NULL DEFAULT 0,
      "createdByUserId" TEXT NOT NULL,
      CONSTRAINT "campaign_handovers_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "campaign_handovers_accessToken_key" ON "campaign_handovers"("accessToken")`,
  `CREATE INDEX IF NOT EXISTS "campaign_handovers_campaignId_status_idx" ON "campaign_handovers"("campaignId","status")`,
  `CREATE INDEX IF NOT EXISTS "campaign_handovers_organizationId_createdAt_idx" ON "campaign_handovers"("organizationId","createdAt")`,
  `CREATE INDEX IF NOT EXISTS "campaign_handovers_accessToken_idx" ON "campaign_handovers"("accessToken")`,
  `CREATE TABLE IF NOT EXISTS "campaign_handover_assets" (
      "id" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "handoverId" TEXT NOT NULL,
      "assetId" TEXT NOT NULL,
      "versionId" TEXT NOT NULL,
      "shareToken" TEXT,
      CONSTRAINT "campaign_handover_assets_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "campaign_handover_assets_handoverId_assetId_key" ON "campaign_handover_assets"("handoverId","assetId")`,
  `CREATE INDEX IF NOT EXISTS "campaign_handover_assets_handoverId_idx" ON "campaign_handover_assets"("handoverId")`,
  `CREATE INDEX IF NOT EXISTS "campaign_handover_assets_assetId_idx" ON "campaign_handover_assets"("assetId")`,
];

const FKS = [
  `DO $$ BEGIN
     ALTER TABLE "campaign_handovers" ADD CONSTRAINT "campaign_handovers_campaignId_fkey"
       FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
     ALTER TABLE "campaign_handover_assets" ADD CONSTRAINT "campaign_handover_assets_handoverId_fkey"
       FOREIGN KEY ("handoverId") REFERENCES "campaign_handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
];

(async () => {
  try {
    await prisma.$executeRawUnsafe(ENUM_DDL);
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    for (const sql of FKS) await prisma.$executeRawUnsafe(sql);
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "campaign_handovers"`);
    log(`ok — handover ready (${n} handover${n === 1 ? '' : 's'} recorded)`);
  } catch (err) {
    log('WARNING — could not ensure campaign handover:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
