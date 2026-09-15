-- Phase 1 Credentials projection. Additive. Does not alter certificates, vault, DNA, assets, or Exchange.

CREATE TYPE "CredentialType" AS ENUM ('CERTIFICATE', 'AWARD', 'LICENSE', 'COURSE', 'WORKSHOP');
CREATE TYPE "CredentialSourceType" AS ENUM ('PINIT_CERTIFICATE', 'USER_AWARD', 'EXCHANGE_LICENSE', 'PINIT_CAREER', 'PINIT_BUSINESS');
CREATE TYPE "CredentialTrustState" AS ENUM ('PINIT_VERIFIED', 'PINIT_ISSUED', 'SELF_ADDED', 'SELF_ADDED_EVIDENCE_PROTECTED', 'COMING_SOON');
CREATE TYPE "CredentialLifecycleStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ARCHIVED');

CREATE TABLE IF NOT EXISTS "credentials" (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "credentials_sourceType_sourceId_key" ON "credentials"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "credentials_userId_type_idx" ON "credentials"("userId", "type");
CREATE INDEX IF NOT EXISTS "credentials_userId_createdAt_idx" ON "credentials"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "credentials_lifecycleStatus_idx" ON "credentials"("lifecycleStatus");
CREATE INDEX IF NOT EXISTS "credentials_issuedAt_idx" ON "credentials"("issuedAt");
CREATE INDEX IF NOT EXISTS "credentials_assetId_idx" ON "credentials"("assetId");

DO $$ BEGIN
  ALTER TABLE "credentials" ADD CONSTRAINT "credentials_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
