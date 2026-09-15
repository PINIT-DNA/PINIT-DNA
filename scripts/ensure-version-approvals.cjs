/**
 * COLLABORATION PHASE 3 — version_approvals (identity-bound approval records).
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Creates one table and one enum, adds one column to share_links
 *   - DROPS / RENAMES / DELETES nothing
 *   - allowApproval defaults false, so no existing share link gains the right
 *     to approve anything
 *
 * Runs after ensure-asset-versions because of the foreign key.
 *
 * Paired with prisma/migrations/20260825200000_version_approvals — production
 * boots through this chain, not through `prisma migrate deploy`. See
 * docs/DATABASE_MIGRATIONS.md.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-version-approvals]', ...a);

const ENUM_DDL = `DO $$ BEGIN
  CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

const DDL = [
  `CREATE TABLE IF NOT EXISTS "version_approvals" (
      "id"                    TEXT         NOT NULL,
      "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "organizationId"        TEXT         NOT NULL,
      "clientId"              TEXT,
      "campaignId"            TEXT         NOT NULL,
      "assetId"               TEXT         NOT NULL,
      "versionId"             TEXT         NOT NULL,
      "decision"              "ApprovalDecision" NOT NULL,
      "comment"               TEXT,
      "approvedByUserId"      TEXT,
      "approvedByRecipientId" TEXT,
      "approverLabel"         TEXT         NOT NULL,
      "shareToken"            TEXT,
      "otpVerified"           BOOLEAN      NOT NULL DEFAULT false,
      "deviceFingerprint"     TEXT,
      "ipAddress"             TEXT,
      CONSTRAINT "version_approvals_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "version_approvals_versionId_createdAt_idx" ON "version_approvals"("versionId","createdAt")`,
  `CREATE INDEX IF NOT EXISTS "version_approvals_campaignId_decision_idx" ON "version_approvals"("campaignId","decision")`,
  `CREATE INDEX IF NOT EXISTS "version_approvals_organizationId_createdAt_idx" ON "version_approvals"("organizationId","createdAt")`,
  `CREATE INDEX IF NOT EXISTS "version_approvals_assetId_idx" ON "version_approvals"("assetId")`,
  `ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "allowApproval" BOOLEAN NOT NULL DEFAULT false`,
];

const FK_DDL = `DO $$ BEGIN
  ALTER TABLE "version_approvals"
    ADD CONSTRAINT "version_approvals_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "asset_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

(async () => {
  try {
    await prisma.$executeRawUnsafe(ENUM_DDL);
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(FK_DDL);
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "version_approvals"`);
    log(`ok — version_approvals present (${n} decision${n === 1 ? '' : 's'} recorded)`);
  } catch (err) {
    log('WARNING — could not ensure version_approvals:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
