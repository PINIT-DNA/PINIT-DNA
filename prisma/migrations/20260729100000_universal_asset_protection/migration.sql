-- Additive: Universal Asset Protection layer
-- Does NOT drop or rename existing Publish Guardian tables.

CREATE TYPE "AssetType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO', 'OTHER');
CREATE TYPE "AssetStatus" AS ENUM ('DRAFT', 'PROTECTED', 'MONITORING', 'DISCOVERY', 'INVESTIGATING', 'RESOLVED', 'ARCHIVED', 'FAILED');
CREATE TYPE "AssetTimelineType" AS ENUM (
  'CREATED', 'PROTECTED', 'CERTIFICATE', 'MONITORING_STARTED', 'MONITORING_SCAN',
  'DISCOVERY', 'TAMPERING', 'INVESTIGATION', 'EVIDENCE', 'ALERT', 'RESOLVED',
  'STATUS_CHANGE', 'NOTE', 'EXPORT_CAPTURE'
);

CREATE TABLE "assets" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "assetType" "AssetType" NOT NULL DEFAULT 'IMAGE',
  "status" "AssetStatus" NOT NULL DEFAULT 'DRAFT',
  "originalFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "contentHash" TEXT,
  "vaultId" TEXT,
  "dnaId" TEXT,
  "certificateId" TEXT,
  "monitorRecordId" TEXT,
  "monitorStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "monitorJobId" TEXT,
  "sourcePlatform" TEXT,
  "sourceUrl" TEXT,
  "capturedVia" TEXT NOT NULL DEFAULT 'extension_publish_guardian',
  "clientRequestId" TEXT,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "riskSeverity" TEXT NOT NULL DEFAULT 'LOW',
  "discoveriesCount" INTEGER NOT NULL DEFAULT 0,
  "lastScanAt" TIMESTAMP(3),
  "lastDiscoveryAt" TIMESTAMP(3),
  "fingerprints" JSONB,
  "metadata" JSONB,
  CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assets_ownerUserId_clientRequestId_key" ON "assets"("ownerUserId", "clientRequestId");
CREATE INDEX "assets_ownerUserId_createdAt_idx" ON "assets"("ownerUserId", "createdAt");
CREATE INDEX "assets_assetType_idx" ON "assets"("assetType");
CREATE INDEX "assets_status_idx" ON "assets"("status");
CREATE INDEX "assets_monitorStatus_idx" ON "assets"("monitorStatus");
CREATE INDEX "assets_dnaId_idx" ON "assets"("dnaId");
CREATE INDEX "assets_vaultId_idx" ON "assets"("vaultId");

ALTER TABLE "assets" ADD CONSTRAINT "assets_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_dnaId_fkey"
  FOREIGN KEY ("dnaId") REFERENCES "dna_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "asset_timeline_events" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assetId" TEXT NOT NULL,
  "eventType" "AssetTimelineType" NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "platform" TEXT,
  "url" TEXT,
  "similarity" DOUBLE PRECISION,
  "tampered" BOOLEAN,
  "riskScore" INTEGER,
  "confidence" DOUBLE PRECISION,
  "investigationId" TEXT,
  "evidenceId" TEXT,
  "payload" JSONB,
  CONSTRAINT "asset_timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_timeline_events_assetId_createdAt_idx" ON "asset_timeline_events"("assetId", "createdAt");
CREATE INDEX "asset_timeline_events_eventType_idx" ON "asset_timeline_events"("eventType");
ALTER TABLE "asset_timeline_events" ADD CONSTRAINT "asset_timeline_events_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "asset_discoveries" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "assetId" TEXT NOT NULL,
  "platform" TEXT,
  "sourcePlatform" TEXT,
  "url" TEXT NOT NULL,
  "pageTitle" TEXT,
  "similarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "similarityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tampering" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "tampered" BOOLEAN NOT NULL DEFAULT false,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "severity" TEXT NOT NULL DEFAULT 'LOW',
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "matchedAssetId" TEXT,
  "matchedVaultId" TEXT,
  "matchedDnaId" TEXT,
  "investigationId" TEXT,
  "evidenceId" TEXT,
  "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "alertStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  CONSTRAINT "asset_discoveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_discoveries_assetId_createdAt_idx" ON "asset_discoveries"("assetId", "createdAt");
CREATE INDEX "asset_discoveries_url_idx" ON "asset_discoveries"("url");
CREATE INDEX "asset_discoveries_severity_idx" ON "asset_discoveries"("severity");
CREATE INDEX "asset_discoveries_alertStatus_idx" ON "asset_discoveries"("alertStatus");
ALTER TABLE "asset_discoveries" ADD CONSTRAINT "asset_discoveries_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Link ProtectedPost → Asset (nullable, additive)
ALTER TABLE "protected_posts" ADD COLUMN IF NOT EXISTS "assetId" TEXT;
CREATE INDEX IF NOT EXISTS "protected_posts_assetId_idx" ON "protected_posts"("assetId");
ALTER TABLE "protected_posts" ADD CONSTRAINT "protected_posts_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
