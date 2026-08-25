/**
 * COLLABORATION PHASE 2 — review_comments (comments + change requests).
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Creates one new table and two new enums, all guarded
 *   - DROPS / RENAMES / DELETES nothing
 *   - Touches no column on any existing table
 *   - Backfills nothing
 *
 * Paired with prisma/migrations/20260825140000_review_comments. Production boots
 * via `npm run start:prod`, which runs this ensure-* chain and does NOT run
 * `prisma migrate deploy` — see docs/DATABASE_MIGRATIONS.md. The migration file
 * is the reviewable source of truth; this script is what applies it in
 * production. Both carry the same DDL.
 *
 * Runs after ensure-asset-versions.cjs because review_comments has a foreign key
 * to asset_versions.
 *
 * Does NOT touch: biometric, face, voice, PAD, WebAuthn, DNA engine, Vault,
 * auth, tenant isolation, listings, checkout, payments, delivery, sharing.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-review-comments]', ...a);

const ENUM_DDL = [
  `DO $$ BEGIN
     CREATE TYPE "CommentKind" AS ENUM ('COMMENT', 'CHANGE_REQUEST');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
     CREATE TYPE "CommentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
];

const DDL = [
  `CREATE TABLE IF NOT EXISTS "review_comments" (
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
   )`,
  `CREATE INDEX IF NOT EXISTS "review_comments_versionId_createdAt_idx"
      ON "review_comments"("versionId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "review_comments_assetId_versionId_createdAt_idx"
      ON "review_comments"("assetId", "versionId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "review_comments_campaignId_status_idx"
      ON "review_comments"("campaignId", "status")`,
  `CREATE INDEX IF NOT EXISTS "review_comments_campaignId_kind_status_idx"
      ON "review_comments"("campaignId", "kind", "status")`,
  `CREATE INDEX IF NOT EXISTS "review_comments_parentId_idx"
      ON "review_comments"("parentId")`,
];

const FK_DDL = [
  `DO $$ BEGIN
     ALTER TABLE "review_comments"
       ADD CONSTRAINT "review_comments_versionId_fkey"
       FOREIGN KEY ("versionId") REFERENCES "asset_versions"("id")
       ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
     ALTER TABLE "review_comments"
       ADD CONSTRAINT "review_comments_parentId_fkey"
       FOREIGN KEY ("parentId") REFERENCES "review_comments"("id")
       ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
];

(async () => {
  try {
    for (const sql of ENUM_DDL) await prisma.$executeRawUnsafe(sql);
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    for (const sql of FK_DDL) await prisma.$executeRawUnsafe(sql);

    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int n FROM "review_comments"`,
    );
    log(`ok — review_comments present (${n} comment${n === 1 ? '' : 's'})`);
  } catch (err) {
    // Never block boot over a feature table.
    log('WARNING — could not ensure review_comments:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
