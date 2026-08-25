-- =============================================================================
-- COLLABORATION PHASE 2: ReviewComment — comments and change requests
--
-- ADDITIVE ONLY. This migration:
--   * DROPS nothing
--   * RENAMES nothing
--   * DELETES no data
--   * Adds one new table and two new enums
--   * Touches no existing column on any existing table
--
-- Paired with scripts/ensure-review-comments.cjs, which is what actually
-- applies this in production — see docs/DATABASE_MIGRATIONS.md. Both files
-- carry the same DDL; changing one without the other is a bug.
--
-- Applied with `prisma db execute`, never `prisma migrate dev`, because this
-- database carries pre-existing drift and migrate dev offers to reset it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
--
-- A change request is not merely a comment (spec §13): it is actionable and has
-- its own lifecycle. The distinction is a discriminator rather than a second
-- table, so the two behave differently without splitting the team's inbox.
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "CommentKind" AS ENUM ('COMMENT', 'CHANGE_REQUEST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "CommentStatus" AS ENUM (
        'OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 2. review_comments
--
-- Always anchored to a version: a comment that only names an asset becomes
-- meaningless the moment V2 lands.
--
-- Two nullable author columns rather than one polymorphic id: authorUserId for
-- internal staff, authorRecipientId for a client reviewing through a share link
-- who has no user account. Exactly one is set, enforced in the service.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "review_comments" (
    "id"                TEXT         NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    "organizationId"    TEXT         NOT NULL,
    "campaignId"        TEXT         NOT NULL,
    "assetId"           TEXT         NOT NULL,
    "versionId"         TEXT         NOT NULL,

    "kind"              "CommentKind"   NOT NULL DEFAULT 'COMMENT',
    "status"            "CommentStatus" NOT NULL DEFAULT 'OPEN',
    "parentId"          TEXT,

    "authorUserId"      TEXT,
    "authorRecipientId" TEXT,
    "authorLabel"       TEXT         NOT NULL,

    "body"              TEXT         NOT NULL,
    "mentionedUserIds"  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],

    "anchor"            JSONB,
    "anchorOrphaned"    BOOLEAN      NOT NULL DEFAULT false,

    "resolvedAt"        TIMESTAMP(3),
    "resolvedByUserId"  TEXT,

    CONSTRAINT "review_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "review_comments_versionId_createdAt_idx"
    ON "review_comments"("versionId", "createdAt");
CREATE INDEX IF NOT EXISTS "review_comments_assetId_versionId_createdAt_idx"
    ON "review_comments"("assetId", "versionId", "createdAt");
CREATE INDEX IF NOT EXISTS "review_comments_campaignId_status_idx"
    ON "review_comments"("campaignId", "status");
-- Drives the "n change requests need response" counter on campaign overview.
CREATE INDEX IF NOT EXISTS "review_comments_campaignId_kind_status_idx"
    ON "review_comments"("campaignId", "kind", "status");
CREATE INDEX IF NOT EXISTS "review_comments_parentId_idx"
    ON "review_comments"("parentId");

-- Deleting a version takes its comments; deleting a thread root takes replies.
DO $$ BEGIN
    ALTER TABLE "review_comments"
        ADD CONSTRAINT "review_comments_versionId_fkey"
        FOREIGN KEY ("versionId") REFERENCES "asset_versions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "review_comments"
        ADD CONSTRAINT "review_comments_parentId_fkey"
        FOREIGN KEY ("parentId") REFERENCES "review_comments"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
