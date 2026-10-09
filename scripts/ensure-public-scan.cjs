/**
 * Per-asset public scan choices on dna_records.
 * Safe to re-run. Does not change existing rows' meaning: new columns default to hidden title,
 * hidden recipient, and public scan still allowed.
 * Do not run this against production until the owner of the database says so.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "publicScanOptOut" BOOLEAN NOT NULL DEFAULT false;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "publicScanShowTitle" BOOLEAN NOT NULL DEFAULT false;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "publicScanShowRecipient" BOOLEAN NOT NULL DEFAULT false;
  `);
  console.log('[ensure-public-scan] public scan columns are ready');
}

main()
  .catch((err) => {
    console.error('[ensure-public-scan] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
