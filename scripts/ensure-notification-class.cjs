/**
 * NOTIFICATIONS — class and entity reference.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Adds three nullable columns to the EXISTING notifications table
 *   - DROPS / RENAMES / DELETES nothing, and backfills nothing
 *   - Creates no second notification store
 *
 * Paired with prisma/migrations/20260827100000_notification_class.
 * See docs/DATABASE_MIGRATIONS.md.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-notification-class]', ...a);

const DDL = [
  `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "notificationClass" TEXT;`,
  `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "entityType" TEXT;`,
  `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "entityId" TEXT;`,
  `CREATE INDEX IF NOT EXISTS "notifications_userId_notificationClass_read_idx"
     ON "notifications"("userId", "notificationClass", "read");`,
  `CREATE INDEX IF NOT EXISTS "notifications_entityType_entityId_idx"
     ON "notifications"("entityType", "entityId");`,
];

(async () => {
  try {
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "notifications"`);
    const [{ c }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int c FROM "notifications" WHERE "notificationClass" IS NOT NULL`);
    log(`ok — ${n} notification(s) preserved, ${c} classified`);
  } catch (err) {
    log('WARNING — could not ensure notification class:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
