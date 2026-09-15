-- Publish Guardian (additive) — Protected posts, timeline, discoveries, extension auth

CREATE TYPE "ProtectedPostStatus" AS ENUM (
  'REGISTERED', 'PROTECTED', 'MONITORING', 'DISCOVERY', 'TAMPERING',
  'INVESTIGATION', 'EVIDENCE', 'RESOLVED', 'FAILED', 'ARCHIVED'
);

CREATE TYPE "ProtectedPostTimelineType" AS ENUM (
  'ORIGINAL_PUBLISHED', 'PROTECTED', 'MONITORING_STARTED', 'MONITORING_SCAN',
  'DISCOVERY', 'TAMPERING', 'INVESTIGATION', 'EVIDENCE', 'ALERT',
  'RESOLVED', 'STATUS_CHANGE', 'NOTE'
);

CREATE TABLE IF NOT EXISTS "protected_posts" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tenantId" TEXT,
  "ownerUserId" TEXT NOT NULL,
  "vaultId" TEXT,
  "dnaRecordId" TEXT,
  "certificateId" TEXT,
  "monitorRecordId" TEXT,
  "platform" TEXT NOT NULL,
  "platformPostId" TEXT,
  "postUrl" TEXT,
  "ownerAccount" TEXT,
  "mediaUrl" TEXT,
  "mediaHash" TEXT,
  "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
  "thumbnail" TEXT,
  "caption" TEXT,
  "publishedAt" TIMESTAMP(3),
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "watchUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "monitorStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastScanAt" TIMESTAMP(3),
  "lastDiscoveryAt" TIMESTAMP(3),
  "discoveriesCount" INTEGER NOT NULL DEFAULT 0,
  "tamperedCount" INTEGER NOT NULL DEFAULT 0,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "status" "ProtectedPostStatus" NOT NULL DEFAULT 'REGISTERED',
  "extensionVersion" TEXT,
  "capturedVia" TEXT NOT NULL DEFAULT 'extension_publish_guardian',
  "pageTitle" TEXT,
  "metadata" JSONB,

  CONSTRAINT "protected_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "protected_post_timeline_events" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "protectedPostId" TEXT NOT NULL,
  "eventType" "ProtectedPostTimelineType" NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "platform" TEXT,
  "url" TEXT,
  "dnaMatchPercent" DOUBLE PRECISION,
  "tampered" BOOLEAN,
  "riskScore" INTEGER,
  "confidence" DOUBLE PRECISION,
  "investigationId" TEXT,
  "evidenceId" TEXT,
  "crawlResultId" TEXT,
  "payload" JSONB,

  CONSTRAINT "protected_post_timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "protected_post_discoveries" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "protectedPostId" TEXT NOT NULL,
  "platform" TEXT,
  "discoveryUrl" TEXT NOT NULL,
  "pageTitle" TEXT,
  "matchType" TEXT NOT NULL DEFAULT 'POSSIBLE',
  "dnaMatchPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "similarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tampered" BOOLEAN NOT NULL DEFAULT false,
  "tamperSummary" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "investigationId" TEXT,
  "crawlResultId" TEXT,
  "alertStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "evidenceReady" BOOLEAN NOT NULL DEFAULT false,
  "thumbnailUrl" TEXT,
  "payload" JSONB,

  CONSTRAINT "protected_post_discoveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "extension_auth_codes" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "code" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "extensionId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),

  CONSTRAINT "extension_auth_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "extension_auth_codes_code_key" ON "extension_auth_codes"("code");
CREATE INDEX IF NOT EXISTS "extension_auth_codes_code_idx" ON "extension_auth_codes"("code");
CREATE INDEX IF NOT EXISTS "extension_auth_codes_expiresAt_idx" ON "extension_auth_codes"("expiresAt");

CREATE INDEX IF NOT EXISTS "protected_posts_ownerUserId_createdAt_idx" ON "protected_posts"("ownerUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "protected_posts_platform_idx" ON "protected_posts"("platform");
CREATE INDEX IF NOT EXISTS "protected_posts_status_idx" ON "protected_posts"("status");
CREATE INDEX IF NOT EXISTS "protected_posts_dnaRecordId_idx" ON "protected_posts"("dnaRecordId");
CREATE INDEX IF NOT EXISTS "protected_posts_vaultId_idx" ON "protected_posts"("vaultId");
CREATE INDEX IF NOT EXISTS "protected_posts_mediaHash_idx" ON "protected_posts"("mediaHash");
CREATE INDEX IF NOT EXISTS "protected_posts_postUrl_idx" ON "protected_posts"("postUrl");

CREATE INDEX IF NOT EXISTS "protected_post_timeline_events_protectedPostId_createdAt_idx"
  ON "protected_post_timeline_events"("protectedPostId", "createdAt");
CREATE INDEX IF NOT EXISTS "protected_post_timeline_events_eventType_idx"
  ON "protected_post_timeline_events"("eventType");

CREATE INDEX IF NOT EXISTS "protected_post_discoveries_protectedPostId_createdAt_idx"
  ON "protected_post_discoveries"("protectedPostId", "createdAt");
CREATE INDEX IF NOT EXISTS "protected_post_discoveries_alertStatus_idx"
  ON "protected_post_discoveries"("alertStatus");
CREATE INDEX IF NOT EXISTS "protected_post_discoveries_discoveryUrl_idx"
  ON "protected_post_discoveries"("discoveryUrl");

ALTER TABLE "protected_posts"
  ADD CONSTRAINT "protected_posts_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "protected_posts"
  ADD CONSTRAINT "protected_posts_dnaRecordId_fkey"
  FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "protected_post_timeline_events"
  ADD CONSTRAINT "protected_post_timeline_events_protectedPostId_fkey"
  FOREIGN KEY ("protectedPostId") REFERENCES "protected_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "protected_post_discoveries"
  ADD CONSTRAINT "protected_post_discoveries_protectedPostId_fkey"
  FOREIGN KEY ("protectedPostId") REFERENCES "protected_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "extension_auth_codes"
  ADD CONSTRAINT "extension_auth_codes_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
