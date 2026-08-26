/**
 * COLLABORATION PHASE C LAYERS 5-6 — client reports.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Creates one table, `client_reports`
 *   - DROPS / RENAMES / DELETES nothing
 *   - Creates no second evidence system: EvidenceRecord stays the only evidence
 *     store, and generateEvidenceReport stays the only PDF engine
 *
 * Paired with prisma/migrations/20260826210000_client_reports — production boots
 * through this chain, not `prisma migrate deploy`. See docs/DATABASE_MIGRATIONS.md.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-client-reports]', ...a);

const DDL = [
  `CREATE TABLE IF NOT EXISTS "client_reports" (
      "id" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      "reportCode" TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "investigationId" TEXT NOT NULL,
      "clientId" TEXT,
      "title" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'DRAFT',
      "accessToken" TEXT NOT NULL,
      "expiresAt" TIMESTAMP(3),
      "issuedAt" TIMESTAMP(3),
      "revokedAt" TIMESTAMP(3),
      "firstOpenedAt" TIMESTAMP(3),
      "lastOpenedAt" TIMESTAMP(3),
      "openCount" INTEGER NOT NULL DEFAULT 0,
      "generatedByUserId" TEXT,
      "evidenceCount" INTEGER NOT NULL DEFAULT 0,
      "contentHash" TEXT,
      "snapshot" TEXT,
      CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id")
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "client_reports_reportCode_key" ON "client_reports"("reportCode");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "client_reports_accessToken_key" ON "client_reports"("accessToken");`,
  `CREATE INDEX IF NOT EXISTS "client_reports_organizationId_createdAt_idx" ON "client_reports"("organizationId", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "client_reports_campaignId_idx" ON "client_reports"("campaignId");`,
  `CREATE INDEX IF NOT EXISTS "client_reports_investigationId_idx" ON "client_reports"("investigationId");`,
];

(async () => {
  try {
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "client_reports"`);
    log(`ok — client reports ready (${n} report${n === 1 ? '' : 's'} issued)`);
  } catch (err) {
    log('WARNING — could not ensure client reports:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
