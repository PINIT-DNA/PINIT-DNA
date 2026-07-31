-- Append-only forensic provenance (chain of custody). DNA is never modified.
CREATE TABLE IF NOT EXISTS "forensic_provenance_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "dnaRecordId" TEXT,
    "vaultId" TEXT,
    "certificateId" TEXT,
    "tepCode" TEXT,
    "shareLinkId" TEXT,
    "investigationId" TEXT,
    "actorUserId" TEXT,
    "actorLabel" TEXT,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationSource" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "device" TEXT,
    "dedupeKey" TEXT,

    CONSTRAINT "forensic_provenance_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "forensic_provenance_events_dedupeKey_key" ON "forensic_provenance_events"("dedupeKey");
CREATE INDEX IF NOT EXISTS "forensic_provenance_events_dnaRecordId_createdAt_idx" ON "forensic_provenance_events"("dnaRecordId", "createdAt");
CREATE INDEX IF NOT EXISTS "forensic_provenance_events_vaultId_createdAt_idx" ON "forensic_provenance_events"("vaultId", "createdAt");
CREATE INDEX IF NOT EXISTS "forensic_provenance_events_eventType_idx" ON "forensic_provenance_events"("eventType");
CREATE INDEX IF NOT EXISTS "forensic_provenance_events_investigationId_idx" ON "forensic_provenance_events"("investigationId");

ALTER TABLE "forensic_provenance_events"
  ADD CONSTRAINT "forensic_provenance_events_dnaRecordId_fkey"
  FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
