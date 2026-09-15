/**
 * Persist image-analysis status columns on vault_records.
 * ADDITIVE AND IDEMPOTENT. Safe on every boot.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-vault-analysis]', ...a);

const STMTS = [
  `ALTER TABLE "vault_records" ADD COLUMN IF NOT EXISTS "contentAnalysisStatus" TEXT NOT NULL DEFAULT 'NOT_ANALYZED'`,
  `ALTER TABLE "vault_records" ADD COLUMN IF NOT EXISTS "contentAnalysisError" TEXT`,
  `ALTER TABLE "vault_records" ADD COLUMN IF NOT EXISTS "contentAnalyzedAt" TIMESTAMP(3)`,
];

(async () => {
  try {
    for (const sql of STMTS) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (err) {
        log('skip', err.message);
      }
    }
    await prisma.$executeRawUnsafe(`
      UPDATE "vault_records"
      SET "contentAnalysisStatus" = 'COMPLETED',
          "contentAnalyzedAt" = COALESCE("contentAnalyzedAt", "createdAt")
      WHERE "contentAnalysis" IS NOT NULL
        AND "contentAnalysisStatus" = 'NOT_ANALYZED'
    `).catch((err) => log('backfill skip', err.message));
    log('ok — vault analysis status columns ready');
  } catch (err) {
    log('WARNING — could not ensure vault analysis columns:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
