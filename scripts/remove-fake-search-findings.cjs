/**
 * Remove the 36 fake crawler evidence rows that recorded search-engine pages
 * as copies of an asset. Does not delete scan history, live DNA, campaign
 * cases, or client reports.
 *
 *   node scripts/remove-fake-search-findings.cjs
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const SEARCH_HOSTS = [
  'google.com', 'www.google.com',
  'bing.com', 'www.bing.com',
  'search.yahoo.com',
  'duckduckgo.com', 'html.duckduckgo.com',
  'yandex.com', 'yandex.ru',
];

function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; }
}

function isSearchUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  return SEARCH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function metaLooksLikeSearch(meta) {
  return isSearchUrl(meta?.url || meta?.sourceUrl || meta?.pageUrl);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('BLOCKED: DATABASE_URL is not set.');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const evidenceRows = await prisma.evidenceRecord.findMany({
      where: { evidenceType: 'CRAWLER_MATCH' },
      select: {
        id: true, evidenceCode: true, incidentId: true, dnaRecordId: true,
        metadata: true, description: true,
      },
    });

    const fakeEvidence = [];
    let skipped = 0;
    for (const row of evidenceRows) {
      let meta = {};
      try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch { meta = {}; }

      const search = metaLooksLikeSearch(meta)
        || isSearchUrl(row.description)
        || /duckduckgo|bing\.com|google\.com\/search/i.test(String(row.description || ''));
      if (!search) continue;

      const [incident, dna, discovery, reportHit] = await Promise.all([
        row.incidentId
          ? prisma.incident.findUnique({
            where: { id: row.incidentId },
            select: { id: true, campaignId: true, organizationId: true },
          })
          : null,
        row.dnaRecordId
          ? prisma.dnaRecord.findUnique({ where: { id: row.dnaRecordId }, select: { id: true } })
          : null,
        prisma.assetDiscovery.findFirst({ where: { evidenceId: row.id }, select: { id: true } }),
        row.incidentId
          ? prisma.clientReport.findFirst({
            where: { investigationId: row.incidentId },
            select: { id: true },
          })
          : null,
      ]);

      if (incident?.campaignId || incident?.organizationId || dna || discovery || reportHit) {
        skipped += 1;
        continue;
      }
      fakeEvidence.push(row);
    }

    const fakeEvidenceIds = fakeEvidence.map((r) => r.id);
    const fakeIncidentIds = [...new Set(fakeEvidence.map((r) => r.incidentId).filter(Boolean))];

    if (!fakeEvidenceIds.length) {
      console.log(JSON.stringify({ ok: true, deletedEvidence: 0, deletedIncidents: 0, skipped, note: 'Nothing matched.' }));
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.assetTimelineEvent.deleteMany({
        where: { evidenceId: { in: fakeEvidenceIds } },
      }).catch(() => ({ count: 0 }));

      await tx.crawlerMatch.updateMany({
        where: { evidenceId: { in: fakeEvidenceIds } },
        data: { evidenceId: null },
      }).catch(() => {});

      const ev = await tx.evidenceRecord.deleteMany({
        where: { id: { in: fakeEvidenceIds } },
      });

      const leftover = await tx.evidenceRecord.findMany({
        where: { incidentId: { in: fakeIncidentIds } },
        select: { incidentId: true },
      });
      const stillUsed = new Set(leftover.map((r) => r.incidentId));
      const orphanIncidents = fakeIncidentIds.filter((id) => !stillUsed.has(id));

      let incidentCount = 0;
      if (orphanIncidents.length) {
        const inc = await tx.incident.deleteMany({
          where: {
            id: { in: orphanIncidents },
            campaignId: null,
            organizationId: null,
          },
        });
        incidentCount = inc.count;
      }

      return { evidence: ev.count, incidents: incidentCount };
    });

    console.log(JSON.stringify({
      ok: true,
      deletedEvidence: result.evidence,
      deletedIncidents: result.incidents,
      skipped,
      codes: fakeEvidence.map((r) => r.evidenceCode),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
