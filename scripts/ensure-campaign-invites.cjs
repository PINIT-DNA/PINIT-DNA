/**
 * TEAM — campaign-scoped invitations.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Adds two nullable columns to the EXISTING organization_invites table
 *   - DROPS / RENAMES / DELETES nothing, and backfills nothing
 *   - Creates no second invitation system and no parallel auth path
 *
 * Paired with prisma/migrations/20260827120000_campaign_scoped_invites.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-campaign-invites]', ...a);

const DDL = [
  `ALTER TABLE "organization_invites" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;`,
  `ALTER TABLE "organization_invites" ADD COLUMN IF NOT EXISTS "campaignRole" TEXT;`,
  `CREATE INDEX IF NOT EXISTS "organization_invites_campaignId_status_idx"
     ON "organization_invites"("campaignId", "status");`,
];

(async () => {
  try {
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "organization_invites"`);
    log(`ok — ${n} invite(s) preserved`);
  } catch (err) {
    log('WARNING — could not ensure campaign invites:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
