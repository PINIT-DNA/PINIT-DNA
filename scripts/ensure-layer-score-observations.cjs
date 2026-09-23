/**
 * Real-world-scale monitoring for the comparison engine's per-layer scores
 * (item 4.6: L2/L4 were verified correct against our own test images, but
 * that's not the same claim as "holds up at production scale" — this table
 * is what makes that checkable, by logging real scores as investigations
 * actually run).
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Creates ONE new table, `layer_score_observations`, if missing.
 *   - Touches no existing table or column.
 *
 * Names match what `prisma db push` generates from prisma/schema.prisma
 * (model LayerScoreObservation), so the two never drift.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-layer-score-observations]', ...a);

const STATEMENTS = [
  ['layer_score_observations table', `
    CREATE TABLE IF NOT EXISTS "layer_score_observations" (
      "id"              TEXT             NOT NULL,
      "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "investigationId" TEXT,
      "dnaRecordId"     TEXT,
      "layer"           INTEGER          NOT NULL,
      "layerName"       TEXT             NOT NULL,
      "similarityScore" DOUBLE PRECISION NOT NULL,
      "matched"         BOOLEAN          NOT NULL,
      "skipped"         BOOLEAN          NOT NULL DEFAULT false,
      "context"         TEXT             NOT NULL DEFAULT 'investigation',
      CONSTRAINT "layer_score_observations_pkey" PRIMARY KEY ("id")
    )`],
  ['layer_score_observations layer+createdAt index',
    `CREATE INDEX IF NOT EXISTS "layer_score_observations_layer_createdAt_idx" ON "layer_score_observations" ("layer", "createdAt")`],
  ['layer_score_observations dnaRecordId index',
    `CREATE INDEX IF NOT EXISTS "layer_score_observations_dnaRecordId_idx" ON "layer_score_observations" ("dnaRecordId")`],
];

async function main() {
  for (const [label, sql] of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
    log(`ok: ${label}`);
  }
}

main()
  .catch((err) => {
    // Never block boot: monitoring degrades to "no data logged" if this
    // table is ever missing — it does not fail any real feature.
    console.error('[ensure-layer-score-observations] failed (non-fatal):', err && err.message ? err.message : err);
  })
  .finally(() => prisma.$disconnect());
