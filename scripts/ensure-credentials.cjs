/**
 * Phase 1 Hub credentials projection table.
 * ADDITIVE AND IDEMPOTENT. Safe on every boot.
 * Paired with prisma/migrations/20260909140000_hub_credentials.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-credentials]', ...a);

const STMTS = [
  `DO $$ BEGIN CREATE TYPE "CredentialType" AS ENUM ('CERTIFICATE', 'AWARD', 'LICENSE', 'COURSE', 'WORKSHOP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE "CredentialSourceType" AS ENUM ('PINIT_CERTIFICATE', 'USER_AWARD', 'EXCHANGE_LICENSE', 'PINIT_CAREER', 'PINIT_BUSINESS'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE "CredentialTrustState" AS ENUM ('PINIT_VERIFIED', 'PINIT_ISSUED', 'SELF_ADDED', 'SELF_ADDED_EVIDENCE_PROTECTED', 'COMING_SOON'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE "CredentialLifecycleStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS "credentials" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL,
    "sourceType" "CredentialSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "trustState" "CredentialTrustState" NOT NULL,
    "lifecycleStatus" "CredentialLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "assetId" TEXT,
    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "credentials_sourceType_sourceId_key" ON "credentials"("sourceType", "sourceId")`,
  `CREATE INDEX IF NOT EXISTS "credentials_userId_type_idx" ON "credentials"("userId", "type")`,
  `CREATE INDEX IF NOT EXISTS "credentials_userId_createdAt_idx" ON "credentials"("userId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "credentials_lifecycleStatus_idx" ON "credentials"("lifecycleStatus")`,
  `CREATE INDEX IF NOT EXISTS "credentials_issuedAt_idx" ON "credentials"("issuedAt")`,
  `CREATE INDEX IF NOT EXISTS "credentials_assetId_idx" ON "credentials"("assetId")`,
  `DO $$ BEGIN
    ALTER TABLE "credentials" ADD CONSTRAINT "credentials_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
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
    log('ok — credentials table ready');
  } catch (err) {
    log('WARNING — could not ensure credentials table:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
