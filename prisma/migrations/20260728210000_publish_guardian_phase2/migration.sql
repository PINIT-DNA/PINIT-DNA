-- Publish Guardian Phase 2 — lifecycle, monitoring profile, discovery enrichment, risk

ALTER TYPE "ProtectedPostStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "ProtectedPostStatus" ADD VALUE IF NOT EXISTS 'PUBLISHING';

ALTER TABLE "protected_posts" ADD COLUMN IF NOT EXISTS "currentUrl" TEXT;
ALTER TABLE "protected_posts" ADD COLUMN IF NOT EXISTS "monitorJobId" TEXT;
ALTER TABLE "protected_posts" ADD COLUMN IF NOT EXISTS "lastMonitorError" TEXT;
ALTER TABLE "protected_posts" ADD COLUMN IF NOT EXISTS "nextScanAt" TIMESTAMP(3);
ALTER TABLE "protected_posts" ADD COLUMN IF NOT EXISTS "avgScanMs" INTEGER;
ALTER TABLE "protected_posts" ADD COLUMN IF NOT EXISTS "riskSeverity" TEXT NOT NULL DEFAULT 'LOW';
ALTER TABLE "protected_posts" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

-- Migrate legacy ACTIVE monitor status → RUNNING
UPDATE "protected_posts" SET "monitorStatus" = 'RUNNING' WHERE "monitorStatus" = 'ACTIVE';
UPDATE "protected_posts" SET "monitorStatus" = 'PENDING' WHERE "monitorStatus" IS NULL OR "monitorStatus" = '';

CREATE UNIQUE INDEX IF NOT EXISTS "protected_posts_ownerUserId_clientRequestId_key"
  ON "protected_posts"("ownerUserId", "clientRequestId");
CREATE INDEX IF NOT EXISTS "protected_posts_monitorStatus_idx" ON "protected_posts"("monitorStatus");
CREATE INDEX IF NOT EXISTS "protected_posts_riskSeverity_idx" ON "protected_posts"("riskSeverity");

ALTER TABLE "protected_post_discoveries" ADD COLUMN IF NOT EXISTS "sourcePlatform" TEXT;
ALTER TABLE "protected_post_discoveries" ADD COLUMN IF NOT EXISTS "similarityScore" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "protected_post_discoveries" ADD COLUMN IF NOT EXISTS "tamperingStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "protected_post_discoveries" ADD COLUMN IF NOT EXISTS "severity" TEXT NOT NULL DEFAULT 'LOW';
ALTER TABLE "protected_post_discoveries" ADD COLUMN IF NOT EXISTS "matchedVaultId" TEXT;
ALTER TABLE "protected_post_discoveries" ADD COLUMN IF NOT EXISTS "matchedDnaRecordId" TEXT;
ALTER TABLE "protected_post_discoveries" ADD COLUMN IF NOT EXISTS "evidenceId" TEXT;
ALTER TABLE "protected_post_discoveries" ADD COLUMN IF NOT EXISTS "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "protected_post_discoveries" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "protected_post_discoveries"
SET "similarityScore" = "similarity"
WHERE "similarityScore" = 0 AND "similarity" > 0;

UPDATE "protected_post_discoveries"
SET "sourcePlatform" = "platform"
WHERE "sourcePlatform" IS NULL;

UPDATE "protected_post_discoveries"
SET "tamperingStatus" = CASE WHEN "tampered" THEN 'TAMPERED' ELSE 'CLEAN' END
WHERE "tamperingStatus" = 'UNKNOWN';

CREATE INDEX IF NOT EXISTS "protected_post_discoveries_severity_idx"
  ON "protected_post_discoveries"("severity");
