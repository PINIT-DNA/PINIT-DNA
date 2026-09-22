/**
 * Lifecycle tracking + compact video frame DNA — schema reconciliation.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - platform_events: adds nullable "lifecycleType" and "assetId" columns and two
 *     indexes. Existing rows keep NULL; nothing is backfilled or rewritten.
 *   - AssetTimelineType: adds the UNLISTED value Exchange already sends.
 *   - video_frame_dna: creates the compact per-frame DNA table if missing.
 *   - DELETES NOTHING. Alters no existing column. Legacy per-frame DnaRecord /
 *     LocalDnaPatch rows stay exactly as they are.
 *
 * Names match what `prisma db push` generates from prisma/schema.prisma, so the
 * two never drift.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-lifecycle-tracking]', ...a);

// Each statement runs on its own: ALTER TYPE … ADD VALUE must not share a
// transaction with statements that could use the new value.
const STATEMENTS = [
  ['platform_events.lifecycleType', `ALTER TABLE "platform_events" ADD COLUMN IF NOT EXISTS "lifecycleType" TEXT`],
  ['platform_events.assetId', `ALTER TABLE "platform_events" ADD COLUMN IF NOT EXISTS "assetId" TEXT`],
  ['platform_events assetId index', `CREATE INDEX IF NOT EXISTS "platform_events_assetId_createdAt_idx" ON "platform_events" ("assetId", "createdAt")`],
  ['platform_events lifecycle index', `CREATE INDEX IF NOT EXISTS "platform_events_ownerUserId_lifecycleType_createdAt_idx" ON "platform_events" ("ownerUserId", "lifecycleType", "createdAt")`],
  ['AssetTimelineType.UNLISTED', `ALTER TYPE "AssetTimelineType" ADD VALUE IF NOT EXISTS 'UNLISTED'`],
  ['video_frame_dna table', `
    CREATE TABLE IF NOT EXISTS "video_frame_dna" (
      "id"               TEXT         NOT NULL,
      "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "videoDnaRecordId" TEXT         NOT NULL,
      "ownerUserId"      TEXT         NOT NULL,
      "frameIndex"       INTEGER      NOT NULL,
      "timestampMs"      INTEGER      NOT NULL,
      "width"            INTEGER      NOT NULL,
      "height"           INTEGER      NOT NULL,
      "rgbSha256"        CHAR(64)     NOT NULL,
      "pHash16"          CHAR(16)     NOT NULL,
      "dHash8"           CHAR(8)      NOT NULL,
      "hkcaAlgoVersion"  TEXT,
      "hkcaKeyId"        TEXT,
      "hkcaCellSize"     INTEGER,
      "hkcaTagBytes"     INTEGER,
      "hkcaRoot"         CHAR(64),
      "hkcaRootMac"      CHAR(64),
      "patchPackVersion" TEXT         NOT NULL,
      "patchCount"       INTEGER      NOT NULL,
      "patchPack"        BYTEA        NOT NULL,
      "leafHash"         CHAR(64)     NOT NULL,
      CONSTRAINT "video_frame_dna_pkey" PRIMARY KEY ("id")
    )`],
  ['video_frame_dna unique frame', `CREATE UNIQUE INDEX IF NOT EXISTS "video_frame_dna_videoDnaRecordId_frameIndex_key" ON "video_frame_dna" ("videoDnaRecordId", "frameIndex")`],
  ['video_frame_dna owner index', `CREATE INDEX IF NOT EXISTS "video_frame_dna_ownerUserId_idx" ON "video_frame_dna" ("ownerUserId")`],
  ['video_frame_dna foreign key', `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'video_frame_dna_videoDnaRecordId_fkey') THEN
        ALTER TABLE "video_frame_dna"
          ADD CONSTRAINT "video_frame_dna_videoDnaRecordId_fkey"
          FOREIGN KEY ("videoDnaRecordId") REFERENCES "dna_records" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`],
];

async function main() {
  for (const [label, sql] of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
    log(`ok: ${label}`);
  }
}

main()
  .catch((err) => {
    // Never block boot: every feature using these objects degrades to a logged skip.
    console.error('[ensure-lifecycle-tracking] failed (non-fatal):', err && err.message ? err.message : err);
  })
  .finally(() => prisma.$disconnect());
