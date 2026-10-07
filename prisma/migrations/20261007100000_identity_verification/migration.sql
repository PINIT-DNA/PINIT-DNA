-- Identity Proof Analysis and Verification: run records (encrypted results) and
-- keyed document-number fingerprints for duplicate detection.

CREATE TABLE IF NOT EXISTS "identity_verification_runs" (
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
);
CREATE INDEX IF NOT EXISTS "identity_verification_runs_userId_createdAt_idx" ON "identity_verification_runs"("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "identity_document_fingerprints" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    CONSTRAINT "identity_document_fingerprints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "identity_document_fingerprints_fingerprint_userId_key" ON "identity_document_fingerprints"("fingerprint", "userId");
CREATE INDEX IF NOT EXISTS "identity_document_fingerprints_fingerprint_idx" ON "identity_document_fingerprints"("fingerprint");

ALTER TABLE "identity_verification_runs" ADD CONSTRAINT "identity_verification_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "identity_document_fingerprints" ADD CONSTRAINT "identity_document_fingerprints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
