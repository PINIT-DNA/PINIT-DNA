-- COLLABORATION PHASE C LAYERS 5-6 — client reports.
--
-- ADDITIVE ONLY. One new table. Reuses the existing EvidenceRecord data and the
-- existing generateEvidenceReport drawing engine; creates no second evidence
-- system and no second report generator.
--
-- DROPS / RENAMES / DELETES nothing.

CREATE TABLE IF NOT EXISTS "client_reports" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reportCode" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "clientId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "generatedByUserId" TEXT,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT,
    "snapshot" TEXT,
    CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "client_reports_reportCode_key" ON "client_reports"("reportCode");
CREATE UNIQUE INDEX IF NOT EXISTS "client_reports_accessToken_key" ON "client_reports"("accessToken");
CREATE INDEX IF NOT EXISTS "client_reports_organizationId_createdAt_idx" ON "client_reports"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "client_reports_campaignId_idx" ON "client_reports"("campaignId");
CREATE INDEX IF NOT EXISTS "client_reports_investigationId_idx" ON "client_reports"("investigationId");
