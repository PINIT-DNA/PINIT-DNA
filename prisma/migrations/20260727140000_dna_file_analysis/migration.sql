-- Auto file analysis on DNA generate → shown in Vault Details
ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "fileAnalysis" JSONB;
ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "fileAnalysisLabel" TEXT;
