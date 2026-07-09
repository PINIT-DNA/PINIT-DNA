/**
 * Ensures crawler_jobs and crawler_matches tables exist (Phase 1 engine).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SQL = [
  `CREATE TABLE IF NOT EXISTS "crawler_jobs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "monitorRecordId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "payload" JSONB,
    CONSTRAINT "crawler_jobs_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "crawler_matches" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monitorRecordId" TEXT NOT NULL,
    "dnaRecordId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "platform" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "assetUrl" TEXT,
    "assetType" TEXT NOT NULL DEFAULT 'unknown',
    "similarity" DOUBLE PRECISION NOT NULL,
    "matchType" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "incidentId" TEXT,
    "investigationId" TEXT,
    "evidenceId" TEXT,
    "metadata" JSONB,
    CONSTRAINT "crawler_matches_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "crawler_jobs_status_scheduledAt_idx" ON "crawler_jobs"("status", "scheduledAt")`,
  `CREATE INDEX IF NOT EXISTS "crawler_jobs_monitorRecordId_idx" ON "crawler_jobs"("monitorRecordId")`,
  `CREATE INDEX IF NOT EXISTS "crawler_jobs_platform_idx" ON "crawler_jobs"("platform")`,
  `CREATE INDEX IF NOT EXISTS "crawler_matches_monitorRecordId_idx" ON "crawler_matches"("monitorRecordId")`,
  `CREATE INDEX IF NOT EXISTS "crawler_matches_dnaRecordId_idx" ON "crawler_matches"("dnaRecordId")`,
  `CREATE INDEX IF NOT EXISTS "crawler_matches_ownerUserId_idx" ON "crawler_matches"("ownerUserId")`,
  `CREATE INDEX IF NOT EXISTS "crawler_matches_platform_idx" ON "crawler_matches"("platform")`,
  `CREATE INDEX IF NOT EXISTS "crawler_matches_similarity_idx" ON "crawler_matches"("similarity")`,
];

async function main() {
  for (const sql of SQL) {
    await prisma.$executeRawUnsafe(`${sql};`);
  }
  console.log('[ensure-crawler-tables] crawler_jobs + crawler_matches ready');
}

main()
  .catch((err) => {
    console.error('[ensure-crawler-tables] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
