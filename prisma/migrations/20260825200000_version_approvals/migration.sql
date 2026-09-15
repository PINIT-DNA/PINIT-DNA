-- =============================================================================
-- COLLABORATION PHASE 3: VersionApproval — identity-bound approval records
--
-- ADDITIVE ONLY. Adds one table, one enum, one column on share_links.
--   * DROPS nothing, RENAMES nothing, DELETES no data
--   * allowApproval defaults false, so no existing link gains approval rights
--
-- The table is insert-only by construction of the service layer: nothing in the
-- codebase updates a row here. A decision is reversed by recording a new one
-- against a new version, never by rewriting history.
--
-- Paired with scripts/ensure-version-approvals.cjs — see
-- docs/DATABASE_MIGRATIONS.md. Applied with `db execute`, never `migrate dev`.
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "version_approvals" (
    "id"                    TEXT         NOT NULL,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "organizationId"        TEXT         NOT NULL,
    "clientId"              TEXT,
    "campaignId"            TEXT         NOT NULL,
    "assetId"               TEXT         NOT NULL,
    "versionId"             TEXT         NOT NULL,

    "decision"              "ApprovalDecision" NOT NULL,
    "comment"               TEXT,

    -- Identity evidence: what makes the record defensible later.
    "approvedByUserId"      TEXT,
    "approvedByRecipientId" TEXT,
    "approverLabel"         TEXT         NOT NULL,
    "shareToken"            TEXT,
    "otpVerified"           BOOLEAN      NOT NULL DEFAULT false,
    "deviceFingerprint"     TEXT,
    "ipAddress"             TEXT,

    CONSTRAINT "version_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "version_approvals_versionId_createdAt_idx"
    ON "version_approvals"("versionId", "createdAt");
CREATE INDEX IF NOT EXISTS "version_approvals_campaignId_decision_idx"
    ON "version_approvals"("campaignId", "decision");
CREATE INDEX IF NOT EXISTS "version_approvals_organizationId_createdAt_idx"
    ON "version_approvals"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "version_approvals_assetId_idx"
    ON "version_approvals"("assetId");

DO $$ BEGIN
    ALTER TABLE "version_approvals"
        ADD CONSTRAINT "version_approvals_versionId_fkey"
        FOREIGN KEY ("versionId") REFERENCES "asset_versions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "allowApproval" BOOLEAN NOT NULL DEFAULT false;
