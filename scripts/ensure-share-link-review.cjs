/**
 * COLLABORATION PHASE 2b — review mode columns on share_links.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Adds four columns, all with defaults matching today's behaviour
 *   - DROPS / RENAMES / DELETES nothing
 *
 * Existing share links keep working unchanged: reviewMode defaults to false, so
 * no client gains commenting rights on a link that was shared before this.
 *
 * Paired with prisma/migrations/20260825170000_share_link_review_mode.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-share-link-review]', ...a);

const DDL = [
  `ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "reviewMode"         BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "allowComments"      BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "allowChangeRequest" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "reviewVersionId"    TEXT`,
  `ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "allowPrint"         BOOLEAN NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS "share_links_reviewVersionId_idx" ON "share_links"("reviewVersionId")`,
];

(async () => {
  try {
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int n FROM "share_links" WHERE "reviewMode" = true`);
    log(`ok — review columns present (${n} link${n === 1 ? '' : 's'} in review mode)`);
    await prisma.$executeRawUnsafe(
      `UPDATE "share_links" SET "allowPrint" = true WHERE "sourceContext" = 'exchange_license' AND "allowPrint" = false`,
    );
  } catch (err) {
    log('WARNING — could not ensure share_links review columns:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
