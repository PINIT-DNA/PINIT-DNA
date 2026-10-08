/**
 * Ensures the identity-verification tables exist (run records + keyed document
 * fingerprints) the optional back-side columns, and the encrypted verified-details column on government_id_records.
 * Additive and idempotent. Mirrors prisma/migrations/20261007100000_identity_verification
 * 20261007160000_government_id_back_side and 20261008120000_government_id_verified_details.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SQL = [
  // Back side of a government ID. Guarded so a database without the table never fails the deploy.
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'government_id_records') THEN
      ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "backStoragePath" TEXT;
      ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "backContentHash" TEXT;
      ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "backMimeType" TEXT;
      ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "backByteLength" INTEGER;
      ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "identityDataCipher" BYTEA;
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS "identity_verification_runs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "documentTypes" TEXT[],
    "findingCodes" TEXT[],
    "stageStatuses" JSONB NOT NULL,
    "resultCipher" BYTEA NOT NULL,
    "encryptionKeyVersion" TEXT NOT NULL DEFAULT 'v1',
    CONSTRAINT "identity_verification_runs_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "identity_verification_runs_userId_createdAt_idx" ON "identity_verification_runs"("userId", "createdAt")`,
  `CREATE TABLE IF NOT EXISTS "identity_document_fingerprints" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    CONSTRAINT "identity_document_fingerprints_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "identity_document_fingerprints_fingerprint_userId_key" ON "identity_document_fingerprints"("fingerprint", "userId")`,
  `CREATE INDEX IF NOT EXISTS "identity_document_fingerprints_fingerprint_idx" ON "identity_document_fingerprints"("fingerprint")`,
];

const FKS = [
  ['identity_verification_runs_userId_fkey', 'identity_verification_runs'],
  ['identity_document_fingerprints_userId_fkey', 'identity_document_fingerprints'],
];

async function main() {
  for (const sql of SQL) {
    await prisma.$executeRawUnsafe(sql);
  }
  for (const [name, table] of FKS) {
    try {
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
            ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
              FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
          END IF;
        END $$;
      `);
    } catch (err) {
      console.warn(`[ensure-identity-verification] FK ${name} skipped:`, err.message || err);
    }
  }
  console.log('[ensure-identity-verification] ready');
}

main()
  .catch((err) => {
    console.error('[ensure-identity-verification] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
