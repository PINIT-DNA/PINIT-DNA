-- PINIT Local DNA Feature Index — patch-level fingerprints for fragment identification

CREATE TABLE "local_feature_indexes" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dnaRecordId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "vaultId" TEXT,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "patchSize" INTEGER NOT NULL DEFAULT 32,
    "gridCols" INTEGER NOT NULL,
    "gridRows" INTEGER NOT NULL,
    "patchCount" INTEGER NOT NULL,
    "globalPHash" TEXT,
    "orbKeypoints" INTEGER NOT NULL DEFAULT 0,
    "orbDescriptors" JSONB,
    "indexVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',

    CONSTRAINT "local_feature_indexes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_dna_patches" (
    "id" TEXT NOT NULL,
    "indexId" TEXT NOT NULL,
    "patchIndex" INTEGER NOT NULL,
    "gridX" INTEGER NOT NULL,
    "gridY" INTEGER NOT NULL,
    "pHash16" TEXT NOT NULL,
    "edgeSignature" TEXT,
    "colorVector" JSONB,
    "frequencySig" TEXT,

    CONSTRAINT "local_dna_patches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "local_feature_indexes_dnaRecordId_key" ON "local_feature_indexes"("dnaRecordId");
CREATE INDEX "local_feature_indexes_ownerUserId_idx" ON "local_feature_indexes"("ownerUserId");
CREATE UNIQUE INDEX "local_dna_patches_indexId_patchIndex_key" ON "local_dna_patches"("indexId", "patchIndex");
CREATE INDEX "local_dna_patches_indexId_idx" ON "local_dna_patches"("indexId");
CREATE INDEX "local_dna_patches_pHash16_idx" ON "local_dna_patches"("pHash16");

ALTER TABLE "local_feature_indexes" ADD CONSTRAINT "local_feature_indexes_dnaRecordId_fkey" FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_feature_indexes" ADD CONSTRAINT "local_feature_indexes_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_dna_patches" ADD CONSTRAINT "local_dna_patches_indexId_fkey" FOREIGN KEY ("indexId") REFERENCES "local_feature_indexes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
