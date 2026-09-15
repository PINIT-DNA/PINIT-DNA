/**
 * Phase 1 Hub portfolio tables.
 * ADDITIVE AND IDEMPOTENT. Safe on every boot.
 * Paired with prisma/migrations/20260905120000_hub_portfolio.
 * Does not drop or rewrite Exchange portfolio_profiles.
 *
 * CREATE TABLE IF NOT EXISTS will not add columns to a table that already
 * exists from an older shape. The ALTER ADD COLUMN statements close that gap
 * so Prisma reads/writes do not 500 with P2022.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-portfolio]', ...a);

function statementsFrom(sql) {
  const parts = [];
  let buf = '';
  let inDo = false;
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!inDo && trimmed.startsWith('--')) continue;
    if (/^DO\s+\$\$/i.test(trimmed)) inDo = true;
    buf += `${line}\n`;
    if (inDo && /END\s+\$\$;/.test(trimmed)) {
      parts.push(buf.trim());
      buf = '';
      inDo = false;
    } else if (!inDo && /;\s*$/.test(trimmed)) {
      parts.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean);
}

const COLUMN_PATCHES = [
  `ALTER TABLE "portfolios" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'unlisted'`,
  `ALTER TABLE "portfolios" ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT 'editorial'`,
  `ALTER TABLE "portfolios" ADD COLUMN IF NOT EXISTS "template" TEXT NOT NULL DEFAULT 'individual'`,
  `ALTER TABLE "portfolios" ADD COLUMN IF NOT EXISTS "publishState" TEXT NOT NULL DEFAULT 'DRAFT'`,
  `ALTER TABLE "portfolios" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3)`,
  `ALTER TABLE "portfolios" ADD COLUMN IF NOT EXISTS "publishedVersion" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolios" ADD COLUMN IF NOT EXISTS "publishedSnapshot" JSONB`,
  `ALTER TABLE "portfolios" ADD COLUMN IF NOT EXISTS "featuredListingIds" JSONB`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "headline" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "about" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "location" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "coverUrl" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "heroImageRef" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "quote" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "cvStorageKey" TEXT`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "website" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "contactNote" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "availableFor" JSONB`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "languages" JSONB`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "clientCount" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "specializations" JSONB`,
  `ALTER TABLE "portfolio_profiles" ADD COLUMN IF NOT EXISTS "sectionVisibility" JSONB`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "year" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "client" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "services" JSONB`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft'`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'public'`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "featured" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolio_projects" ADD COLUMN IF NOT EXISTS "coverMediaId" TEXT`,
  `ALTER TABLE "portfolio_project_media" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'IMAGE'`,
  `ALTER TABLE "portfolio_project_media" ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_project_media" ADD COLUMN IF NOT EXISTS "altText" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_project_media" ADD COLUMN IF NOT EXISTS "caption" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_project_media" ADD COLUMN IF NOT EXISTS "vaultId" TEXT`,
  `ALTER TABLE "portfolio_project_media" ADD COLUMN IF NOT EXISTS "assetId" TEXT`,
  `ALTER TABLE "portfolio_project_media" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT`,
  `ALTER TABLE "portfolio_project_media" ADD COLUMN IF NOT EXISTS "storageKey" TEXT`,
  `ALTER TABLE "portfolio_collections" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_collections" ADD COLUMN IF NOT EXISTS "coverUrl" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_collections" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'public'`,
  `ALTER TABLE "portfolio_collections" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolio_collection_items" ADD COLUMN IF NOT EXISTS "projectId" TEXT`,
  `ALTER TABLE "portfolio_collection_items" ADD COLUMN IF NOT EXISTS "assetId" TEXT`,
  `ALTER TABLE "portfolio_collection_items" ADD COLUMN IF NOT EXISTS "vaultId" TEXT`,
  `ALTER TABLE "portfolio_services" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_services" ADD COLUMN IF NOT EXISTS "icon" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_services" ADD COLUMN IF NOT EXISTS "featured" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "portfolio_services" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolio_skills" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_skills" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolio_experience" ADD COLUMN IF NOT EXISTS "company" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_experience" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_experience" ADD COLUMN IF NOT EXISTS "location" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_experience" ADD COLUMN IF NOT EXISTS "startDate" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_experience" ADD COLUMN IF NOT EXISTS "endDate" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_experience" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_experience" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_experience" ADD COLUMN IF NOT EXISTS "website" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_experience" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolio_awards" ADD COLUMN IF NOT EXISTS "organization" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_awards" ADD COLUMN IF NOT EXISTS "year" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_awards" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_awards" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_awards" ADD COLUMN IF NOT EXISTS "imageKey" TEXT`,
  `ALTER TABLE "portfolio_awards" ADD COLUMN IF NOT EXISTS "documentKey" TEXT`,
  `ALTER TABLE "portfolio_awards" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_awards" ADD COLUMN IF NOT EXISTS "relatedProjectId" TEXT`,
  `ALTER TABLE "portfolio_awards" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "issuer" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "recipient" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "issuedOn" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "expiresOn" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "credentialId" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "imageKey" TEXT`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "documentKey" TEXT`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "verificationUrl" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "relatedSkill" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_certificates" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolio_collaborations" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'collaboration'`,
  `ALTER TABLE "portfolio_collaborations" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_collaborations" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_collaborations" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_collaborations" ADD COLUMN IF NOT EXISTS "website" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_collaborations" ADD COLUMN IF NOT EXISTS "year" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_collaborations" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "portfolio_social_links" ADD COLUMN IF NOT EXISTS "label" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "portfolio_social_links" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
];

async function run(sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    log('skip', err.message, sql.slice(0, 88).replace(/\s+/g, ' '));
  }
}

(async () => {
  try {
    const file = path.join(__dirname, '..', 'prisma', 'migrations', '20260905120000_hub_portfolio', 'migration.sql');
    const sql = fs.readFileSync(file, 'utf8');
    for (const stmt of statementsFrom(sql)) {
      await run(stmt);
    }
    for (const stmt of COLUMN_PATCHES) {
      await run(stmt);
    }
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "portfolios"`);
    log(`ok — Hub portfolios ready (${n} row${n === 1 ? '' : 's'})`);
  } catch (err) {
    log('WARNING — could not ensure Hub portfolios:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
