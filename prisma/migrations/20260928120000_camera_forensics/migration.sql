-- Compact camera-sensor PRNU sidecar on DNA records (not a DNA layer; not user identity).
ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "cameraForensics" JSONB;
