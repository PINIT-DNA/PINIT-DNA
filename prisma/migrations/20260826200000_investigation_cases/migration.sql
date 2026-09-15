-- COLLABORATION PHASE C LAYER 4 — investigation cases.
--
-- ADDITIVE ONLY. Extends the existing `incidents` table rather than creating a
-- second investigation architecture: the crawler already opens incidents on a
-- match, evidence_records already hang off them, and asset_discoveries already
-- carries investigationId. Every column below is nullable, so all 36 existing
-- incidents remain valid without a backfill.
--
-- DROPS / RENAMES / DELETES nothing.

ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "assetId" TEXT;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "findingId" TEXT;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "assignedToUserId" TEXT;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "openedByUserId" TEXT;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "closedByUserId" TEXT;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "incidents_campaignId_status_idx" ON "incidents"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "incidents_organizationId_createdAt_idx" ON "incidents"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "incidents_assignedToUserId_idx" ON "incidents"("assignedToUserId");

CREATE TABLE IF NOT EXISTS "incident_notes" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incidentId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorLabel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "incident_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "incident_notes_incidentId_createdAt_idx" ON "incident_notes"("incidentId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "incident_notes" ADD CONSTRAINT "incident_notes_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
