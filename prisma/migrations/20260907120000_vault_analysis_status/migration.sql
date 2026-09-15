-- Persist image-analysis lifecycle on the existing vault record (one job per protected version).
ALTER TABLE "vault_records" ADD COLUMN IF NOT EXISTS "contentAnalysisStatus" TEXT NOT NULL DEFAULT 'NOT_ANALYZED';
ALTER TABLE "vault_records" ADD COLUMN IF NOT EXISTS "contentAnalysisError" TEXT;
ALTER TABLE "vault_records" ADD COLUMN IF NOT EXISTS "contentAnalyzedAt" TIMESTAMP(3);

UPDATE "vault_records"
SET "contentAnalysisStatus" = 'COMPLETED',
    "contentAnalyzedAt" = COALESCE("contentAnalyzedAt", "createdAt")
WHERE "contentAnalysis" IS NOT NULL
  AND "contentAnalysisStatus" = 'NOT_ANALYZED';
