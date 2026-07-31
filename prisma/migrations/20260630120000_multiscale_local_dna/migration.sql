-- Multi-scale Local DNA Index v2.0.0
ALTER TABLE "local_dna_patches" ADD COLUMN IF NOT EXISTS "scale" INTEGER NOT NULL DEFAULT 32;
ALTER TABLE "local_dna_patches" ADD COLUMN IF NOT EXISTS "dHash8" TEXT;
ALTER TABLE "local_dna_patches" ADD COLUMN IF NOT EXISTS "aHash8" TEXT;
ALTER TABLE "local_dna_patches" ADD COLUMN IF NOT EXISTS "textureSig" TEXT;
CREATE INDEX IF NOT EXISTS "local_dna_patches_indexId_scale_idx" ON "local_dna_patches"("indexId", "scale");
