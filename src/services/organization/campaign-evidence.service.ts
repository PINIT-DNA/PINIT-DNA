/**
 * Evidence on an investigation — the chain Finding → Investigation → Evidence.
 *
 * Reuses the existing store and helper. `EvidenceRecord` is the only evidence
 * table, and `createEvidenceRecord` (watermark.service) is the only writer; this
 * service adds campaign scoping, the relationships the case UI needs, and the
 * guard that decides what may be collected in the first place.
 *
 * ── On the 36 records already in the table ──────────────────────────────────
 *
 * Every one of them references a search-engine URL and was collected between
 * 17 and 19 August 2026, before `isSearchResultPageUrl` was added to the crawler.
 * They are artifacts of that bug: the pipeline was comparing protected work
 * against DuckDuckGo's own page furniture. Their DNA records no longer exist and
 * none maps to a campaign asset.
 *
 * They are not deleted here — that is the owner's call, not a side effect of
 * this layer — but they are never presented as evidence of anything. `listFor`
 * scopes to a campaign investigation, which none of them belong to, and
 * `collect` refuses a search-engine URL outright so no more can be created.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { createEvidenceRecord } from '../watermark/watermark.service';
import { isSearchResultPageUrl } from '../crawler/url-sanitize';

/**
 * What a piece of evidence is, in words a non-forensic reader understands.
 *
 * The label is descriptive, never conclusive — "a copy was found at this
 * address" is an observation; whether it is infringement is not this system's
 * call, and the wording holds that line into the client report.
 */
const EVIDENCE_MEANING: Record<string, string> = {
  CRAWLER_MATCH: 'An automated scan found a visually matching copy at this address.',
  MANUAL_SIGHTING: 'A person reported seeing the work at this address.',
  PAGE_CAPTURE: 'The page was captured as it appeared at the time of collection.',
  CLIENT_REPORT: 'The client supplied this.',
  ACCESS_ANOMALY: 'An access to the shared file looked unusual.',
};

function meaningFor(type: string): string {
  return EVIDENCE_MEANING[type] ?? 'Collected during this investigation.';
}

/** Only these can be collected by hand. The rest are written by the engine. */
const COLLECTABLE = ['MANUAL_SIGHTING', 'PAGE_CAPTURE', 'CLIENT_REPORT'];

async function loadCaseScoped(organizationId: string, investigationId: string) {
  const incident = await prisma.incident.findUnique({ where: { id: investigationId } });
  if (!incident) throw new AppError(404, 'Investigation not found');

  if (incident.organizationId && incident.organizationId === organizationId) return incident;
  if (incident.campaignId) {
    const owned = await prisma.campaign.findFirst({
      where: { id: incident.campaignId, organizationId }, select: { id: true },
    });
    if (owned) return incident;
  }
  throw new AppError(404, 'Investigation not found');
}

/** Hostname only — the full URL is shown separately and deliberately. */
function hostOf(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

/**
 * Pull the source URL out of a record.
 *
 * Evidence written by the crawler puts it in `metadata`; evidence collected by
 * hand puts it there too. The description is prose and is not parsed for it.
 */
function sourceOf(metadata: string | null): { url: string | null; platform: string | null } {
  if (!metadata) return { url: null, platform: null };
  try {
    const m = JSON.parse(metadata) as Record<string, unknown>;
    const url = typeof m.sourceUrl === 'string' ? m.sourceUrl
      : typeof m.url === 'string' ? m.url : null;
    const platform = typeof m.platform === 'string' ? m.platform : null;
    return { url, platform };
  } catch {
    return { url: null, platform: null };
  }
}

export const campaignEvidenceService = {
  /**
   * The evidence timeline for one case, oldest first.
   *
   * Each entry carries what it is, where it came from, when it was collected,
   * and which asset and finding it relates to — the relationships the case view
   * needs to make the chain legible.
   */
  async listFor(organizationId: string, actorUserId: string, investigationId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const incident = await loadCaseScoped(organizationId, investigationId);

    const [records, asset, finding] = await Promise.all([
      prisma.evidenceRecord.findMany({
        where: { incidentId: incident.id },
        orderBy: { collectedAt: 'asc' },
        // Explicit select: storagePath and ownerUserId never leave the service.
        select: {
          id: true, evidenceCode: true, evidenceType: true, description: true,
          metadata: true, hash: true, collectedAt: true, createdAt: true,
        },
      }),
      incident.assetId
        ? prisma.asset.findUnique({
            where: { id: incident.assetId },
            select: { id: true, originalFilename: true },
          })
        : Promise.resolve(null),
      incident.findingId
        ? prisma.assetDiscovery.findUnique({
            where: { id: incident.findingId },
            select: { id: true, url: true, platform: true, similarity: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      investigationId: incident.id,
      caseCode: incident.incidentCode,
      /** The relationships, stated once rather than repeated on every row. */
      relatedAsset: asset ? { id: asset.id, filename: asset.originalFilename } : null,
      relatedFinding: finding
        ? {
            id: finding.id, url: finding.url, host: hostOf(finding.url),
            platform: finding.platform, similarity: finding.similarity,
          }
        : null,
      evidence: records.map((e) => {
        const src = sourceOf(e.metadata);
        return {
          id: e.id,
          code: e.evidenceCode,
          type: e.evidenceType,
          meaning: meaningFor(e.evidenceType),
          description: e.description,
          sourceUrl: src.url,
          sourceHost: src.url ? hostOf(src.url) : null,
          platform: src.platform,
          collectedAt: e.collectedAt.toISOString(),
          /** Prefix only — enough to compare copies, not enough to reconstruct. */
          integrity: e.hash ? `${e.hash.slice(0, 12)}…` : null,
          hasIntegrity: Boolean(e.hash),
        };
      }),
      counts: {
        total: records.length,
        withIntegrity: records.filter((e) => e.hash).length,
        byType: records.reduce<Record<string, number>>((acc, e) => {
          acc[e.evidenceType] = (acc[e.evidenceType] ?? 0) + 1;
          return acc;
        }, {}),
      },
      collectableTypes: COLLECTABLE.map((t) => ({ id: t, meaning: meaningFor(t) })),
    };
  },

  /**
   * Collect a piece of evidence onto a case.
   *
   * Refuses a search-engine result page. That is the exact bug that produced the
   * 36 useless records already in the table, and it must not be reachable by
   * hand either — a client report citing duckduckgo.com as the place their work
   * was found is worse than no report.
   */
  async collect(
    organizationId: string,
    actorUserId: string,
    investigationId: string,
    input: { evidenceType: string; description: string; sourceUrl?: string },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const incident = await loadCaseScoped(organizationId, investigationId);

    if (!COLLECTABLE.includes(input.evidenceType)) {
      throw new AppError(400, 'That evidence type cannot be added by hand');
    }
    const description = input.description?.trim();
    if (!description) throw new AppError(400, 'Say what this evidence is');
    if (description.length > 2000) throw new AppError(400, 'Description is too long (2000 max)');

    let sourceUrl: string | null = null;
    if (input.sourceUrl) {
      const raw = input.sourceUrl.trim();
      let parsed: URL;
      try { parsed = new URL(raw); } catch { throw new AppError(400, 'That is not a valid URL'); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new AppError(400, 'Only http and https addresses can be recorded');
      }
      if (isSearchResultPageUrl(raw)) {
        throw new AppError(
          400,
          'That is a search results page, not a place the work is published. '
          + 'Record the page the copy actually appears on.',
        );
      }
      sourceUrl = raw;
    }

    // metadata is hashed by createEvidenceRecord, which is what gives the entry
    // its integrity value — so everything that matters goes in there.
    const metadata = {
      sourceUrl,
      collectedByUserId: actorUserId,
      investigationId: incident.id,
      campaignId: incident.campaignId,
      assetId: incident.assetId,
      findingId: incident.findingId,
      collectedAt: new Date().toISOString(),
    };

    const created = await createEvidenceRecord({
      incidentId: incident.id,
      ...(incident.dnaRecordId ? { dnaRecordId: incident.dnaRecordId } : {}),
      evidenceType: input.evidenceType,
      description,
      metadata,
    });

    if (incident.campaignId) {
      await logOrgAudit({
        organizationId, actorUserId,
        action: 'EVIDENCE_COLLECTED',
        entityType: 'campaign', entityId: incident.campaignId,
        title: `Evidence added to ${incident.incidentCode}`,
        detail: { evidenceCode: created.evidenceCode, type: input.evidenceType, sourceUrl },
      });
    }

    // A note in the case timeline, so the working record shows it happened.
    await prisma.incidentNote.create({
      data: {
        incidentId: incident.id,
        authorLabel: 'System',
        isSystem: true,
        body: `Evidence ${created.evidenceCode} collected (${input.evidenceType}).`,
      },
    });

    return { id: created.id, code: created.evidenceCode };
  },

  /**
   * The evidence behind a case, projected for a client.
   *
   * This is the ONLY path evidence takes to a client, and it is an allowlist:
   * type, meaning, source address, host, when it was collected, and whether it
   * carries an integrity value. Nothing else is copied, so a column added to
   * EvidenceRecord later cannot leak by default.
   *
   * Never included: the record id, the incident id, the DNA record id, the
   * storage path, the owner, the raw metadata, or the full hash.
   */
  async projectForClient(investigationId: string) {
    const records = await prisma.evidenceRecord.findMany({
      where: { incidentId: investigationId },
      orderBy: { collectedAt: 'asc' },
      select: {
        evidenceCode: true, evidenceType: true, description: true,
        metadata: true, hash: true, collectedAt: true,
      },
    });

    return records.map((e) => {
      const src = sourceOf(e.metadata);
      return {
        reference: e.evidenceCode,
        type: e.evidenceType,
        meaning: meaningFor(e.evidenceType),
        description: e.description,
        sourceUrl: src.url,
        sourceHost: src.url ? hostOf(src.url) : null,
        collectedAt: e.collectedAt.toISOString(),
        integrity: e.hash ? `${e.hash.slice(0, 16)}…` : null,
      };
    });
  },
};

/** Stable SHA-256 of a snapshot, for the seal on the client's copy. */
export function hashSnapshot(snapshot: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
