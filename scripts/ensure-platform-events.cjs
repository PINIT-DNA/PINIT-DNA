/**
 * Ensures platform_events table + notification extensions exist.
 * Safe for databases that predate Prisma Migrate (P3005 baseline issues).
 * Never modifies or drops existing DNA / user data.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'system';
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "deepLink" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "aggregateCount" INTEGER NOT NULL DEFAULT 1;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "notifications_userId_dedupeKey_idx"
    ON "notifications"("userId", "dedupeKey");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "platform_events" (
      "id" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "name" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "severity" TEXT NOT NULL,
      "ownerUserId" TEXT NOT NULL,
      "actorUserId" TEXT,
      "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "deepLink" TEXT,
      "dedupeKey" TEXT,
      "payload" JSONB,
      CONSTRAINT "platform_events_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "platform_events_ownerUserId_createdAt_idx"
    ON "platform_events"("ownerUserId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "platform_events_name_createdAt_idx"
    ON "platform_events"("name", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "platform_events_dedupeKey_idx"
    ON "platform_events"("dedupeKey");
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'platform_events_ownerUserId_fkey'
      ) THEN
        ALTER TABLE "platform_events"
          ADD CONSTRAINT "platform_events_ownerUserId_fkey"
          FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  console.log('[ensure-platform-events] platform_events + notification columns are ready');
}

main()
  .catch((err) => {
    console.error('[ensure-platform-events] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
