/**
 * Index from an outgoing-copy mark back to the owner and recipient.
 * Safe to re-run. Does not change DNA rows.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "watermark_lookups" (
      "lookupId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "vaultId" TEXT NOT NULL,
      "dnaRecordId" TEXT NOT NULL,
      "ownerUserId" TEXT NOT NULL,
      "recipientKey" TEXT,
      "recipientLabel" TEXT,
      CONSTRAINT "watermark_lookups_pkey" PRIMARY KEY ("lookupId")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "watermark_lookups_ownerUserId_idx"
    ON "watermark_lookups"("ownerUserId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "watermark_lookups_dnaRecordId_idx"
    ON "watermark_lookups"("dnaRecordId");
  `);
  console.log('[ensure-watermark-lookups] watermark_lookups is ready');
}

main()
  .catch((err) => {
    console.error('[ensure-watermark-lookups] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
