/**
 * Ensures extended notification preference columns exist on users table.
 * Safe for production databases managed via db push / baseline.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const COLUMNS = [
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyVault" BOOLEAN NOT NULL DEFAULT true',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyDna" BOOLEAN NOT NULL DEFAULT true',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyInvestigation" BOOLEAN NOT NULL DEFAULT true',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyAutomation" BOOLEAN NOT NULL DEFAULT true',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifySecurity" BOOLEAN NOT NULL DEFAULT true',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyReports" BOOLEAN NOT NULL DEFAULT true',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifySystem" BOOLEAN NOT NULL DEFAULT true',
  'ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notificationInboxClearedAt" TIMESTAMP(3)',
];

async function main() {
  for (const sql of COLUMNS) {
    await prisma.$executeRawUnsafe(`${sql};`);
  }
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "notifications_userId_archived_idx" ON "notifications"("userId", "archived");
  `);
  console.log('[ensure-notification-prefs] preference columns + archived flag ready');
}

main()
  .catch((err) => {
    console.error('[ensure-notification-prefs] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
