-- =============================================================================
-- COLLABORATION PHASE 4: CampaignMessage — client ↔ team conversation
--
-- ADDITIVE ONLY. One new table; drops and renames nothing.
--
-- No new realtime or notification infrastructure: delivery reuses realtimeHub
-- (already a plain string-keyed pub/sub) with campaign channels, and team
-- notification reuses platformEvents. See docs/DATABASE_MIGRATIONS.md for the
-- two-artifact rule — paired with scripts/ensure-campaign-messages.cjs.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "campaign_messages" (
    "id"                TEXT         NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "organizationId"    TEXT         NOT NULL,
    "campaignId"        TEXT         NOT NULL,
    "assetId"           TEXT,
    "versionId"         TEXT,

    "authorUserId"      TEXT,
    "authorRecipientId" TEXT,
    "authorLabel"       TEXT         NOT NULL,
    "isSystem"          BOOLEAN      NOT NULL DEFAULT false,

    "body"              TEXT         NOT NULL,

    -- Per-side, so neither party can mark the other's messages read.
    "readByTeamAt"      TIMESTAMP(3),
    "readByClientAt"    TIMESTAMP(3),

    CONSTRAINT "campaign_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "campaign_messages_campaignId_createdAt_idx"
    ON "campaign_messages"("campaignId", "createdAt");
CREATE INDEX IF NOT EXISTS "campaign_messages_assetId_createdAt_idx"
    ON "campaign_messages"("assetId", "createdAt");
-- Drives the team's unread badge.
CREATE INDEX IF NOT EXISTS "campaign_messages_campaignId_readByTeamAt_idx"
    ON "campaign_messages"("campaignId", "readByTeamAt");
CREATE INDEX IF NOT EXISTS "campaign_messages_organizationId_idx"
    ON "campaign_messages"("organizationId");

DO $$ BEGIN
    ALTER TABLE "campaign_messages"
        ADD CONSTRAINT "campaign_messages_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
