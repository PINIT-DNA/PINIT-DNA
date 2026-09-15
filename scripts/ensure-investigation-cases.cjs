/**
 * COLLABORATION PHASE C LAYER 4 — investigation cases.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Adds nullable case-management columns to the EXISTING `incidents` table
 *   - Creates one table, `incident_notes`
 *   - DROPS / RENAMES / DELETES nothing, and backfills nothing
 *   - Builds no second investigation model: incidents and evidence_records
 *     already exist and keep their meaning
 *
 * Paired with prisma/migrations/20260826200000_investigation_cases — production
 * boots through this chain, not `prisma migrate deploy`. See
 * docs/DATABASE_MIGRATIONS.md.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-investigation-cases]', ...a);

const COLUMNS = [
  ['title', 'TEXT'],
  ['organizationId', 'TEXT'],
  ['campaignId', 'TEXT'],
  ['assetId', 'TEXT'],
  ['findingId', 'TEXT'],
  ['assignedToUserId', 'TEXT'],
  ['openedByUserId', 'TEXT'],
  ['closedByUserId', 'TEXT'],
  ['closedAt', 'TIMESTAMP(3)'],
];

const DDL = [
  ...COLUMNS.map(([name, type]) =>
    `ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "${name}" ${type};`),

  `CREATE INDEX IF NOT EXISTS "incidents_campaignId_status_idx" ON "incidents"("campaignId", "status");`,
  `CREATE INDEX IF NOT EXISTS "incidents_organizationId_createdAt_idx" ON "incidents"("organizationId", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "incidents_assignedToUserId_idx" ON "incidents"("assignedToUserId");`,

  `CREATE TABLE IF NOT EXISTS "incident_notes" (
      "id" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "incidentId" TEXT NOT NULL,
      "authorUserId" TEXT,
      "authorLabel" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "isSystem" BOOLEAN NOT NULL DEFAULT false,
      CONSTRAINT "incident_notes_pkey" PRIMARY KEY ("id")
   );`,
  `CREATE INDEX IF NOT EXISTS "incident_notes_incidentId_createdAt_idx" ON "incident_notes"("incidentId", "createdAt");`,
];

const FKS = [
  `DO $$ BEGIN
     ALTER TABLE "incident_notes" ADD CONSTRAINT "incident_notes_incidentId_fkey"
       FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
];

(async () => {
  try {
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    for (const sql of FKS) await prisma.$executeRawUnsafe(sql);
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "incidents"`);
    const [{ c }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int c FROM "incidents" WHERE "campaignId" IS NOT NULL`);
    log(`ok — investigations ready (${n} incident${n === 1 ? '' : 's'} preserved, ${c} scoped to a campaign)`);
  } catch (err) {
    log('WARNING — could not ensure investigation cases:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
