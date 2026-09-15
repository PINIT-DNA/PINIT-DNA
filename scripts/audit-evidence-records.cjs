/**
 * Read-only dependency audit for historical EvidenceRecord rows.
 *
 * Does not delete, archive, or update anything. Prints a classification per row
 * using live FK lookups. Run from repo root:
 *
 *   node scripts/audit-evidence-records.cjs
 *
 * Classification:
 *   SHOULD RETAIN     anything referenced by a campaign case, client report,
 *                     discovery, or a DNA/vault asset that still exists
 *   SAFE TO ARCHIVE   search-result-page artifact, DNA gone, no campaign case,
 *                     nothing references the id — still not deleted here
 *   UNKNOWN           metadata cannot be parsed or ownership is ambiguous
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const SEARCH_HOSTS = [
  'google.com', 'www.google.com', 'bing.com', 'www.bing.com',
  'search.yahoo.com', 'duckduckgo.com', 'yandex.com',
];

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function looksLikeSearchPage(meta) {
  const url = String(meta?.url || meta?.sourceUrl || meta?.pageUrl || '');
  const host = hostOf(url);
  if (SEARCH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  if (typeof meta?.isSearchResultPage === 'boolean') return meta.isSearchResultPage;
  return false;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('BLOCKED: DATABASE_URL is not set. No production rows were read or classified.');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.evidenceRecord.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, evidenceCode: true, createdAt: true, incidentId: true,
        dnaRecordId: true, shareLinkId: true, evidenceType: true,
        description: true, metadata: true, ownerUserId: true,
      },
    });

    const summary = { RETAIN: 0, ARCHIVE: 0, UNKNOWN: 0 };
    for (const row of rows) {
      let meta = {};
      try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch { meta = { _unparsed: true }; }

      const [incident, dna, discovery, timeline, reportHit] = await Promise.all([
        row.incidentId
          ? prisma.incident.findUnique({
            where: { id: row.incidentId },
            select: { id: true, campaignId: true, organizationId: true, incidentCode: true, status: true },
          })
          : null,
        row.dnaRecordId
          ? prisma.dnaRecord.findUnique({ where: { id: row.dnaRecordId }, select: { id: true } })
          : null,
        prisma.assetDiscovery.findFirst({ where: { evidenceId: row.id }, select: { id: true, assetId: true } }),
        prisma.assetTimelineEvent.findFirst({ where: { evidenceId: row.id }, select: { id: true, assetId: true } }).catch(() => null),
        prisma.clientReport.findFirst({
          where: { investigationId: row.incidentId ?? '__none__' },
          select: { id: true, reportCode: true },
        }),
      ]);

      const campaignId = incident?.campaignId ?? null;
      const searchJunk = looksLikeSearchPage(meta) || Boolean(meta._unparsed === false && !dna && !campaignId);
      const referenced = Boolean(discovery || timeline || reportHit || campaignId);

      let klass = 'UNKNOWN / NEEDS DECISION';
      if (referenced || dna) klass = 'SHOULD RETAIN';
      else if (searchJunk || (!dna && !campaignId && !row.shareLinkId)) klass = 'SAFE TO ARCHIVE';
      if (meta._unparsed) klass = 'UNKNOWN / NEEDS DECISION';

      if (klass.startsWith('SHOULD')) summary.RETAIN += 1;
      else if (klass.startsWith('SAFE')) summary.ARCHIVE += 1;
      else summary.UNKNOWN += 1;

      console.log(JSON.stringify({
        evidenceId: row.id,
        evidenceCode: row.evidenceCode,
        createdAt: row.createdAt,
        evidenceType: row.evidenceType,
        incidentId: row.incidentId,
        incidentCode: incident?.incidentCode ?? null,
        campaignId,
        organizationId: incident?.organizationId ?? null,
        dnaRecordId: row.dnaRecordId,
        dnaExists: Boolean(dna),
        discoveryId: discovery?.id ?? null,
        assetId: discovery?.assetId ?? timeline?.assetId ?? null,
        reportCode: reportHit?.reportCode ?? null,
        searchPageArtifact: looksLikeSearchPage(meta),
        classification: klass,
      }));
    }
    console.log(JSON.stringify({ total: rows.length, ...summary, deleted: 0 }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
