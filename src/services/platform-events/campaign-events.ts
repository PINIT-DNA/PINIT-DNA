/**
 * Campaign collaboration events (Phase C).
 *
 * These are emitters, not a notification system. Everything below hands one
 * envelope to `platformEvents.emit`, and the existing notification, timeline and
 * audit subscribers decide what to do with it — the same path vault, DNA, share
 * and monitoring events have always taken. There is no second notification
 * table, no second delivery mechanism and no second preference model.
 *
 * The notification types reused here already exist in preference-map.ts, so a
 * user who has turned off monitoring or investigation alerts is respected
 * without anything new being wired.
 *
 * ── Who hears about a campaign ──────────────────────────────────────────────
 *
 * `platformEvents.emit` addresses ONE recipient, so anything the whole team
 * should hear is fanned out here, once per person. The audience is resolved
 * from the database on every emit rather than cached, because someone removed
 * from a campaign this morning must not receive its findings this afternoon.
 *
 * Three rules hold everywhere:
 *
 *   1. Only members of the owning organization. The audience query is rooted at
 *      OrganizationMember, so a user outside the org cannot appear in it even if
 *      they somehow hold a CampaignMember row.
 *
 *   2. Never external collaborators. An outside creator is given scoped access
 *      to specific assets; where a client's work was found copied, and what the
 *      team decided to do about it, is not part of that scope.
 *
 *   3. Never the actor. Being told about something you just did is noise, and
 *      it trains people to ignore the badge.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { platformEvents } from './platform-event.engine';

/** Roles that run the business and should hear about campaign-wide events. */
const LEADERSHIP = ['OWNER', 'MANAGER'] as const;

/**
 * Everyone inside the organization who should hear about this campaign.
 *
 * Leadership plus the internal people actually assigned to the campaign.
 * `also` lets a caller add someone specific — a case assignee, say — and it is
 * still filtered through organization membership, so it cannot be used to
 * address a stranger.
 */
export async function campaignAudience(
  campaignId: string,
  opts: { exclude?: string | null; also?: (string | null | undefined)[] } = {},
): Promise<string[]> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { organizationId: true },
  });
  if (!campaign) return [];

  const [leaders, assigned] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: campaign.organizationId, role: { in: [...LEADERSHIP] } },
      select: { userId: true },
    }),
    prisma.campaignMember.findMany({
      where: {
        campaignId,
        isExternal: false,
        revokedAt: null,
        userId: { not: null },
      },
      select: { userId: true },
    }),
  ]);

  const candidates = new Set<string>();
  for (const l of leaders) candidates.add(l.userId);
  for (const a of assigned) if (a.userId) candidates.add(a.userId);
  for (const extra of opts.also ?? []) if (extra) candidates.add(extra);

  if (candidates.size === 0) return [];

  // The gate that makes rule 1 true: every recipient must still be a member of
  // THIS organization. Anyone added via `also` who has left is dropped here.
  const confirmed = await prisma.organizationMember.findMany({
    where: {
      organizationId: campaign.organizationId,
      userId: { in: [...candidates] },
    },
    select: { userId: true },
  });

  return confirmed
    .map((m) => m.userId)
    .filter((id) => id !== opts.exclude);
}

/** Fan one envelope out to an audience, one notification each. */
function fanOut(
  recipients: string[],
  build: (ownerUserId: string) => Parameters<typeof platformEvents.emit>[0],
): void {
  for (const ownerUserId of recipients) {
    try {
      platformEvents.emit(build(ownerUserId));
    } catch (err) {
      // A notification must never take down the action that caused it.
      logger.warn('[campaign-events] emit failed', {
        ownerUserId, error: (err as Error).message,
      });
    }
  }
}

// ── Monitoring ──────────────────────────────────────────────────────────────

/**
 * Monitoring was turned on or off for a campaign asset.
 *
 * Reuses MONITORING_STARTED / MONITORING_STOPPED, which already map to the
 * notifyMonitoring preference.
 */
export async function emitCampaignMonitoringChanged(params: {
  campaignId: string;
  campaignName: string;
  assetName: string;
  enabled: boolean;
  actorUserId: string;
}): Promise<void> {
  const audience = await campaignAudience(params.campaignId, { exclude: params.actorUserId });
  fanOut(audience, (ownerUserId) => ({
    name: params.enabled ? 'campaign.monitoring_started' : 'campaign.monitoring_stopped',
    category: 'monitoring',
    severity: 'info',
    ownerUserId,
    actorUserId: params.actorUserId,
    entityType: 'campaign',
    entityId: params.campaignId,
    title: params.enabled
      ? `Monitoring started on ${params.assetName}`
      : `Monitoring stopped on ${params.assetName}`,
    body: `${params.campaignName} — ${params.assetName}`,
    deepLink: `/business/campaigns/${params.campaignId}?tab=monitoring`,
    notificationType: params.enabled ? 'MONITORING_STARTED' : 'MONITORING_STOPPED',
    dedupeKey: `campaign-monitoring:${params.campaignId}:${params.assetName}:${params.enabled}`,
    skipTimeline: true,
    skipAudit: true,
  }));
}

// ── Findings ────────────────────────────────────────────────────────────────

/**
 * Somebody decided what a finding was.
 *
 * Only CONFIRMED is worth a notification: a dismissal is the team agreeing
 * nothing is there, and telling everyone about it is how a badge becomes
 * something people stop reading.
 */
export async function emitFindingConfirmed(params: {
  campaignId: string;
  campaignName: string;
  assetName: string;
  host: string | null;
  findingId: string;
  actorUserId: string;
}): Promise<void> {
  const audience = await campaignAudience(params.campaignId, { exclude: params.actorUserId });
  fanOut(audience, (ownerUserId) => ({
    name: 'campaign.finding_confirmed',
    category: 'monitoring',
    severity: 'warning',
    ownerUserId,
    actorUserId: params.actorUserId,
    entityType: 'campaign',
    entityId: params.campaignId,
    title: `Match confirmed on ${params.assetName}`,
    body: params.host
      ? `Confirmed as your work, found on ${params.host}.`
      : 'Confirmed as your work.',
    deepLink: `/business/campaigns/${params.campaignId}?tab=findings`,
    notificationType: 'PUBLISH_GUARDIAN_DISCOVERY',
    dedupeKey: `finding-confirmed:${params.findingId}`,
    skipTimeline: true,
    skipAudit: true,
  }));
}

// ── Investigations ──────────────────────────────────────────────────────────

export async function emitInvestigationOpened(params: {
  campaignId: string;
  campaignName: string;
  caseCode: string;
  title: string;
  priority: string;
  assigneeUserId?: string | null;
  actorUserId: string;
}): Promise<void> {
  const audience = await campaignAudience(params.campaignId, {
    exclude: params.actorUserId,
    also: [params.assigneeUserId],
  });
  fanOut(audience, (ownerUserId) => ({
    name: 'campaign.investigation_opened',
    category: 'investigation',
    severity: params.priority === 'CRITICAL' ? 'critical' : 'warning',
    ownerUserId,
    actorUserId: params.actorUserId,
    entityType: 'campaign',
    entityId: params.campaignId,
    title: `Investigation opened: ${params.title}`,
    body: `${params.caseCode} — ${params.campaignName}`,
    deepLink: `/business/campaigns/${params.campaignId}?tab=investigations`,
    notificationType: 'INVESTIGATION_STARTED',
    dedupeKey: `investigation-opened:${params.caseCode}`,
    skipTimeline: true,
    skipAudit: true,
  }));
}

/**
 * A case was assigned to someone.
 *
 * This one goes to the assignee alone. Being handed a case is personal; the
 * rest of the team does not need a badge for it.
 */
export async function emitInvestigationAssigned(params: {
  campaignId: string;
  caseCode: string;
  title: string;
  assigneeUserId: string;
  actorUserId: string;
}): Promise<void> {
  if (params.assigneeUserId === params.actorUserId) return;
  const audience = await campaignAudience(params.campaignId, {
    exclude: params.actorUserId,
    also: [params.assigneeUserId],
  });
  // Narrow to the assignee, still having passed the organization gate.
  const only = audience.filter((id) => id === params.assigneeUserId);
  fanOut(only, (ownerUserId) => ({
    name: 'campaign.investigation_assigned',
    category: 'investigation',
    severity: 'info',
    ownerUserId,
    actorUserId: params.actorUserId,
    entityType: 'campaign',
    entityId: params.campaignId,
    title: `${params.title} was assigned to you`,
    body: params.caseCode,
    deepLink: `/business/campaigns/${params.campaignId}?tab=investigations`,
    notificationType: 'INVESTIGATION_STARTED',
    dedupeKey: `investigation-assigned:${params.caseCode}:${params.assigneeUserId}`,
    skipTimeline: true,
    skipAudit: true,
  }));
}

export async function emitInvestigationClosed(params: {
  campaignId: string;
  campaignName: string;
  caseCode: string;
  title: string;
  status: string;
  actorUserId: string;
  assigneeUserId?: string | null;
}): Promise<void> {
  const audience = await campaignAudience(params.campaignId, {
    exclude: params.actorUserId,
    also: [params.assigneeUserId],
  });
  fanOut(audience, (ownerUserId) => ({
    name: 'campaign.investigation_closed',
    category: 'investigation',
    severity: 'success',
    ownerUserId,
    actorUserId: params.actorUserId,
    entityType: 'campaign',
    entityId: params.campaignId,
    title: `Investigation closed: ${params.title}`,
    body: `${params.caseCode} — ${params.status.toLowerCase()}`,
    deepLink: `/business/campaigns/${params.campaignId}?tab=investigations`,
    notificationType: 'CASE_CLOSED',
    dedupeKey: `investigation-closed:${params.caseCode}`,
    skipTimeline: true,
    skipAudit: true,
  }));
}

/**
 * A closed case was reopened.
 *
 * Deliberately separate and louder than a status change: someone decided
 * something the team had settled is not settled, and that is worth knowing.
 */
export async function emitInvestigationReopened(params: {
  campaignId: string;
  caseCode: string;
  title: string;
  reason: string;
  actorUserId: string;
  assigneeUserId?: string | null;
}): Promise<void> {
  const audience = await campaignAudience(params.campaignId, {
    exclude: params.actorUserId,
    also: [params.assigneeUserId],
  });
  fanOut(audience, (ownerUserId) => ({
    name: 'campaign.investigation_reopened',
    category: 'investigation',
    severity: 'warning',
    ownerUserId,
    actorUserId: params.actorUserId,
    entityType: 'campaign',
    entityId: params.campaignId,
    title: `Investigation reopened: ${params.title}`,
    body: `${params.caseCode} — ${params.reason.slice(0, 160)}`,
    deepLink: `/business/campaigns/${params.campaignId}?tab=investigations`,
    notificationType: 'INVESTIGATION_STARTED',
    dedupeKey: `investigation-reopened:${params.caseCode}:${Date.now()}`,
    skipTimeline: true,
    skipAudit: true,
  }));
}

// ── Evidence ────────────────────────────────────────────────────────────────

/**
 * Evidence was collected onto a case.
 *
 * Aggregated: adding five items in a sitting is one badge, not five.
 */
export async function emitEvidenceCollected(params: {
  campaignId: string;
  caseCode: string;
  evidenceCode: string;
  evidenceType: string;
  actorUserId: string;
  assigneeUserId?: string | null;
}): Promise<void> {
  const audience = await campaignAudience(params.campaignId, {
    exclude: params.actorUserId,
    also: [params.assigneeUserId],
  });
  fanOut(audience, (ownerUserId) => ({
    name: 'campaign.evidence_collected',
    category: 'investigation',
    severity: 'info',
    ownerUserId,
    actorUserId: params.actorUserId,
    entityType: 'campaign',
    entityId: params.campaignId,
    title: `Evidence added to ${params.caseCode}`,
    body: params.evidenceType.replace(/_/g, ' ').toLowerCase(),
    deepLink: `/business/campaigns/${params.campaignId}?tab=investigations`,
    notificationType: 'EVIDENCE_READY',
    dedupeKey: `evidence-collected:${params.caseCode}`,
    aggregate: true,
    skipTimeline: true,
    skipAudit: true,
  }));
}

// ── Client reports ──────────────────────────────────────────────────────────

export async function emitClientReportIssued(params: {
  campaignId: string;
  campaignName: string;
  reportCode: string;
  title: string;
  actorUserId: string;
}): Promise<void> {
  const audience = await campaignAudience(params.campaignId, { exclude: params.actorUserId });
  fanOut(audience, (ownerUserId) => ({
    name: 'campaign.client_report_issued',
    category: 'reports',
    severity: 'success',
    ownerUserId,
    actorUserId: params.actorUserId,
    entityType: 'campaign',
    entityId: params.campaignId,
    title: `Report issued to the client: ${params.title}`,
    body: `${params.reportCode} — ${params.campaignName}`,
    deepLink: `/business/campaigns/${params.campaignId}?tab=investigations`,
    notificationType: 'REPORT_SHARED',
    dedupeKey: `client-report-issued:${params.reportCode}`,
    skipTimeline: true,
    skipAudit: true,
  }));
}

/**
 * The client opened the report.
 *
 * Only the first open is announced, and only to the person who issued it —
 * that is the one who is waiting to know it landed. There is no actor to
 * exclude here: the client is not a user of this system.
 */
export async function emitClientReportOpened(params: {
  campaignId: string;
  reportCode: string;
  title: string;
  issuedByUserId: string | null;
}): Promise<void> {
  if (!params.issuedByUserId) return;
  const audience = await campaignAudience(params.campaignId, {
    also: [params.issuedByUserId],
  });
  const only = audience.filter((id) => id === params.issuedByUserId);
  fanOut(only, (ownerUserId) => ({
    name: 'campaign.client_report_opened',
    category: 'reports',
    severity: 'info',
    ownerUserId,
    entityType: 'campaign',
    entityId: params.campaignId,
    title: `The client opened ${params.title}`,
    body: params.reportCode,
    deepLink: `/business/campaigns/${params.campaignId}?tab=investigations`,
    notificationType: 'REPORT_DOWNLOADED',
    // First open only — a client rereading it is not news.
    dedupeKey: `client-report-opened:${params.reportCode}`,
    skipTimeline: true,
    skipAudit: true,
  }));
}
