/**
 * COLLABORATION PHASE 5 — scoped access for campaign people.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Adds columns to campaign_members, one enum, one join table
 *   - DROPS / RENAMES / DELETES nothing
 *   - accessStatus defaults to NONE, so nobody already listed on a campaign
 *     gains access because this ran
 *
 * External access is delivered as a scoped ShareLink per assigned asset, so no
 * second access system exists to keep in step with the first.
 *
 * Paired with prisma/migrations/20260826140000_campaign_people_access.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-campaign-people-access]', ...a);

const ENUM_DDL = `DO $$ BEGIN
  CREATE TYPE "MemberAccessStatus" AS ENUM ('NONE','INVITED','ACTIVE','REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

const DDL = [
  `ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "updatedAt"         TIMESTAMP(3)`,
  `ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "email"             TEXT`,
  `ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "accessStatus"      "MemberAccessStatus" NOT NULL DEFAULT 'NONE'`,
  `ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "canComment"        BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "canRequestChanges" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "canApprove"        BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "shareRecipientId"  TEXT`,
  `ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "lastAccessAt"      TIMESTAMP(3)`,
  `ALTER TABLE "campaign_members" ADD COLUMN IF NOT EXISTS "revokedAt"         TIMESTAMP(3)`,
  `UPDATE "campaign_members" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL`,
  `ALTER TABLE "campaign_members" ALTER COLUMN "updatedAt" SET NOT NULL`,
  // Prisma manages @updatedAt in application code; a DB default would show as drift.
  `ALTER TABLE "campaign_members" ALTER COLUMN "updatedAt" DROP DEFAULT`,
  `CREATE TABLE IF NOT EXISTS "campaign_member_assets" (
      "id"         TEXT         NOT NULL,
      "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "memberId"   TEXT         NOT NULL,
      "assetId"    TEXT         NOT NULL,
      "shareToken" TEXT,
      CONSTRAINT "campaign_member_assets_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "campaign_member_assets_memberId_assetId_key" ON "campaign_member_assets"("memberId","assetId")`,
  `CREATE INDEX IF NOT EXISTS "campaign_member_assets_memberId_idx" ON "campaign_member_assets"("memberId")`,
  `CREATE INDEX IF NOT EXISTS "campaign_member_assets_assetId_idx"  ON "campaign_member_assets"("assetId")`,
];

const FK = `DO $$ BEGIN
  ALTER TABLE "campaign_member_assets"
    ADD CONSTRAINT "campaign_member_assets_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "campaign_members"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

(async () => {
  try {
    await prisma.$executeRawUnsafe(ENUM_DDL);
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(FK);
    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int n FROM "campaign_members" WHERE "accessStatus" = 'ACTIVE'`);
    log(`ok — scoped access ready (${n} member${n === 1 ? '' : 's'} with active access)`);
  } catch (err) {
    log('WARNING — could not ensure campaign people access:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
