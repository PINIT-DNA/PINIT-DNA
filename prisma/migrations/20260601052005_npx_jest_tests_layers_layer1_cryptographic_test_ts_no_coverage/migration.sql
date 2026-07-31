-- CreateEnum
CREATE TYPE "DnaStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "dna_records" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "imageFilename" TEXT NOT NULL,
    "imageMimeType" TEXT NOT NULL,
    "imageSizeBytes" INTEGER NOT NULL,
    "imageWidthPx" INTEGER,
    "imageHeightPx" INTEGER,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "status" "DnaStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "dna_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_layers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dnaRecordId" TEXT NOT NULL,
    "sha256Hash" CHAR(64) NOT NULL,
    "normalizedHash" CHAR(64) NOT NULL,
    "blake3Hash" CHAR(64),

    CONSTRAINT "crypto_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structural_layers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dnaRecordId" TEXT NOT NULL,
    "edgeMapB64" TEXT NOT NULL,
    "edgeVectors" JSONB NOT NULL,
    "edgeSignature64" CHAR(16) NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'canny',

    CONSTRAINT "structural_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perceptual_layers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dnaRecordId" TEXT NOT NULL,
    "pHash64" CHAR(16) NOT NULL,
    "pHash256" CHAR(64) NOT NULL,
    "aHash64" CHAR(16) NOT NULL,
    "dHash64" CHAR(16) NOT NULL,

    CONSTRAINT "perceptual_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semantic_layers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dnaRecordId" TEXT NOT NULL,
    "histogramR" JSONB NOT NULL,
    "histogramG" JSONB NOT NULL,
    "histogramB" JSONB NOT NULL,
    "histogramH" JSONB NOT NULL,
    "histogramS" JSONB NOT NULL,
    "dominantColors" JSONB NOT NULL,
    "colorFingerprint" CHAR(12) NOT NULL,

    CONSTRAINT "semantic_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metadata_layers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dnaRecordId" TEXT NOT NULL,
    "exifData" JSONB,
    "deviceMake" TEXT,
    "deviceModel" TEXT,
    "software" TEXT,
    "capturedAt" TIMESTAMP(3),
    "gpsLatitude" DOUBLE PRECISION,
    "gpsLongitude" DOUBLE PRECISION,
    "iptcData" JSONB,
    "xmpData" JSONB,
    "metadataHash" CHAR(64) NOT NULL,

    CONSTRAINT "metadata_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stego_layers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dnaRecordId" TEXT NOT NULL,
    "embedded" BOOLEAN NOT NULL DEFAULT false,
    "capacityBits" INTEGER,
    "usedBits" INTEGER,
    "payloadHmac" CHAR(64) NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'B',
    "carrierPath" TEXT,

    CONSTRAINT "stego_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dnaRecordId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "layerResults" JSONB NOT NULL,
    "similarityScores" JSONB NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "layersChecked" TEXT[],
    "requestIp" TEXT,

    CONSTRAINT "verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crypto_layers_dnaRecordId_key" ON "crypto_layers"("dnaRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "structural_layers_dnaRecordId_key" ON "structural_layers"("dnaRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "perceptual_layers_dnaRecordId_key" ON "perceptual_layers"("dnaRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_layers_dnaRecordId_key" ON "semantic_layers"("dnaRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "metadata_layers_dnaRecordId_key" ON "metadata_layers"("dnaRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "stego_layers_dnaRecordId_key" ON "stego_layers"("dnaRecordId");

-- AddForeignKey
ALTER TABLE "crypto_layers" ADD CONSTRAINT "crypto_layers_dnaRecordId_fkey" FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structural_layers" ADD CONSTRAINT "structural_layers_dnaRecordId_fkey" FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perceptual_layers" ADD CONSTRAINT "perceptual_layers_dnaRecordId_fkey" FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semantic_layers" ADD CONSTRAINT "semantic_layers_dnaRecordId_fkey" FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metadata_layers" ADD CONSTRAINT "metadata_layers_dnaRecordId_fkey" FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stego_layers" ADD CONSTRAINT "stego_layers_dnaRecordId_fkey" FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_logs" ADD CONSTRAINT "verification_logs_dnaRecordId_fkey" FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
