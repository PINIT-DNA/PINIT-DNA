-- Redundant ownership watermark details on stego_layers
ALTER TABLE "stego_layers" ADD COLUMN IF NOT EXISTS "ownershipSignature" JSONB;
ALTER TABLE "stego_layers" ADD COLUMN IF NOT EXISTS "ownershipAlgorithm" TEXT;
ALTER TABLE "stego_layers" ADD COLUMN IF NOT EXISTS "ownershipTileCount" INTEGER;
ALTER TABLE "stego_layers" ADD COLUMN IF NOT EXISTS "ownershipDnaFp" CHAR(32);

CREATE INDEX IF NOT EXISTS "stego_layers_ownershipDnaFp_idx" ON "stego_layers"("ownershipDnaFp");
