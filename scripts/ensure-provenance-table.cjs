/**
 * Ensures forensic_provenance_events exists.
 * Safe for databases that predate Prisma Migrate (P3005 baseline issues).
 * Never modifies DNA tables.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "forensic_provenance_events" (
      "id" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "eventType" TEXT NOT NULL,
      "dnaRecordId" TEXT,
      "vaultId" TEXT,
      "certificateId" TEXT,
      "tepCode" TEXT,
      "shareLinkId" TEXT,
      "investigationId" TEXT,
      "actorUserId" TEXT,
      "actorLabel" TEXT,
      "summary" TEXT NOT NULL,
      "payload" JSONB NOT NULL DEFAULT '{}',
      "country" TEXT,
      "region" TEXT,
      "city" TEXT,
      "latitude" DOUBLE PRECISION,
      "longitude" DOUBLE PRECISION,
      "locationSource" TEXT,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "device" TEXT,
      "dedupeKey" TEXT,
      CONSTRAINT "forensic_provenance_events_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "forensic_provenance_events_dedupeKey_key"
    ON "forensic_provenance_events"("dedupeKey");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "forensic_provenance_events_dnaRecordId_createdAt_idx"
    ON "forensic_provenance_events"("dnaRecordId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "forensic_provenance_events_vaultId_createdAt_idx"
    ON "forensic_provenance_events"("vaultId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "forensic_provenance_events_eventType_idx"
    ON "forensic_provenance_events"("eventType");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "forensic_provenance_events_investigationId_idx"
    ON "forensic_provenance_events"("investigationId");
  `);

  // FK only if not already present
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'forensic_provenance_events_dnaRecordId_fkey'
      ) THEN
        ALTER TABLE "forensic_provenance_events"
          ADD CONSTRAINT "forensic_provenance_events_dnaRecordId_fkey"
          FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  console.log('[ensure-provenance-table] forensic_provenance_events is ready');
}

main()
  .catch((err) => {
    console.error('[ensure-provenance-table] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
