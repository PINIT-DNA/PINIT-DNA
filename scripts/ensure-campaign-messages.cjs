/**
 * COLLABORATION PHASE 4 — campaign_messages (client ↔ team conversation).
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Creates one table; DROPS / RENAMES / DELETES nothing
 *   - Adds no realtime or notification infrastructure: delivery reuses
 *     realtimeHub, and team notification reuses platformEvents
 *
 * Paired with prisma/migrations/20260826090000_campaign_messages — production
 * boots through this chain, not `prisma migrate deploy`. See
 * docs/DATABASE_MIGRATIONS.md.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-campaign-messages]', ...a);

const DDL = [
  `CREATE TABLE IF NOT EXISTS "campaign_messages" (
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
      "readByTeamAt"      TIMESTAMP(3),
      "readByClientAt"    TIMESTAMP(3),
      CONSTRAINT "campaign_messages_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "campaign_messages_campaignId_createdAt_idx" ON "campaign_messages"("campaignId","createdAt")`,
  `CREATE INDEX IF NOT EXISTS "campaign_messages_assetId_createdAt_idx" ON "campaign_messages"("assetId","createdAt")`,
  `CREATE INDEX IF NOT EXISTS "campaign_messages_campaignId_readByTeamAt_idx" ON "campaign_messages"("campaignId","readByTeamAt")`,
  `CREATE INDEX IF NOT EXISTS "campaign_messages_organizationId_idx" ON "campaign_messages"("organizationId")`,
];

const FK = `DO $$ BEGIN
  ALTER TABLE "campaign_messages"
    ADD CONSTRAINT "campaign_messages_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

(async () => {
  try {
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(FK);
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "campaign_messages"`);
    log(`ok — campaign_messages present (${n} message${n === 1 ? '' : 's'})`);
  } catch (err) {
    log('WARNING — could not ensure campaign_messages:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
