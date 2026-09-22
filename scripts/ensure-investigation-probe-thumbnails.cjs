/**
 * Investigation probe thumbnails — durable "Examined File" preview.
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Creates ONE new table, `investigation_probe_thumbnails`, if missing.
 *   - Touches no existing table or column.
 *
 * Names match what `prisma db push` generates from prisma/schema.prisma
 * (model InvestigationProbeThumbnail), so the two never drift.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-investigation-probe-thumbnails]', ...a);

const STATEMENTS = [
  ['investigation_probe_thumbnails table', `
    CREATE TABLE IF NOT EXISTS "investigation_probe_thumbnails" (
      "id"              TEXT         NOT NULL,
      "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "investigationId" TEXT         NOT NULL,
      "ownerUserId"     TEXT         NOT NULL,
      "mimeType"        TEXT         NOT NULL,
      "filename"        TEXT,
      "width"           INTEGER,
      "height"          INTEGER,
      "data"            BYTEA        NOT NULL,
      CONSTRAINT "investigation_probe_thumbnails_pkey" PRIMARY KEY ("id")
    )`],
  ['investigation_probe_thumbnails investigationId unique',
    `CREATE UNIQUE INDEX IF NOT EXISTS "investigation_probe_thumbnails_investigationId_key" ON "investigation_probe_thumbnails" ("investigationId")`],
  ['investigation_probe_thumbnails ownerUserId index',
    `CREATE INDEX IF NOT EXISTS "investigation_probe_thumbnails_ownerUserId_idx" ON "investigation_probe_thumbnails" ("ownerUserId")`],
];

async function main() {
  for (const [label, sql] of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
    log(`ok: ${label}`);
  }
}

main()
  .catch((err) => {
    // Never block boot: the feature degrades to "Preview not available" if this table
    // is ever missing, same as today — it does not fail the investigation itself.
    console.error('[ensure-investigation-probe-thumbnails] failed (non-fatal):', err && err.message ? err.message : err);
  })
  .finally(() => prisma.$disconnect());
