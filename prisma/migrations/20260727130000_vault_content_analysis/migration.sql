-- Whole-file content analysis on vault_records (Vault Explorer Details)
ALTER TABLE "vault_records" ADD COLUMN IF NOT EXISTS "contentLabel" TEXT;
ALTER TABLE "vault_records" ADD COLUMN IF NOT EXISTS "contentAnalysis" JSONB;

CREATE INDEX IF NOT EXISTS "vault_records_contentLabel_idx" ON "vault_records"("contentLabel");
