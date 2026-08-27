/**
 * Notification policy — the single source of truth for who hears about what.
 *
 * Every business event that can produce a notification is declared here exactly
 * once, with seven things settled in one place:
 *
 *   1. what event triggers it
 *   2. who receives it, derived from the actual relationship
 *   3. who must never receive it
 *   4. what entity it is about
 *   5. what the recipient should do
 *   6. what the message says
 *   7. where a click lands
 *
 * Call sites do not decide any of that. A service calls `emitBusinessEvent`
 * with a context and the policy resolves the rest, so "who gets this" cannot
 * drift from one call site to another — which is exactly how a notification
 * system becomes untrustworthy.
 *
 * ── The three classes ───────────────────────────────────────────────────────
 *
 *   ACTIVITY      Something happened. It belongs in a timeline, not a badge.
 *                 "The client opened the secure review link."
 *   NOTIFICATION  Someone specific needs to know, and usually to act.
 *                 "Adhureddy requested changes to Version 2 of Campaign X."
 *   ALERT         Something is wrong and wants attention now.
 *                 "A confirmed external copy of Asset Y was detected."
 *
 * Only NOTIFICATION and ALERT reach the bell. ACTIVITY is written for the
 * timeline and never raises a badge.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 *
 * Reads, page opens, background scans and successful scans that found nothing
 * produce NO event at all. A scan completing is not news; a scan finding
 * something is. That distinction is enforced by omission — there is no
 * definition for them, and `emitBusinessEvent` refuses an unknown event.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { platformEvents } from './platform-event.engine';

export type NotificationClass = 'ACTIVITY' | 'NOTIFICATION' | 'ALERT';

/** Everything a definition may need. Services pass what applies. */
export interface EventContext {
  organizationId?: string;
  campaignId?: string;
  campaignName?: string;
  assetId?: string;
  assetName?: string;
  versionId?: string;
  versionNumber?: number;
  commentId?: string;
  findingId?: string;
  investigationId?: string;
  caseCode?: string;
  evidenceCode?: string;
  reportId?: string;
  reportCode?: string;
  handoverId?: string;
  recipientLabel?: string;
  /** Who did it. Never notified about their own action. */
  actorUserId?: string | null;
  /** Display name of whoever acted, including a client with no account. */
  actorLabel?: string;
  /** Explicitly addressed people — still filtered through the org gate. */
  targetUserIds?: (string | null | undefined)[];
  status?: string;
  detail?: string;
  host?: string;
  similarityPercent?: number;
}

interface EventDefinition {
  /** What actually happened, in the product's terms. */
  trigger: string;
  class: NotificationClass;
  /** Reuses an existing key from preference-map.ts. No new preference model. */
  notificationType: string;
  category: 'sharing' | 'monitoring' | 'investigation' | 'reports' | 'security';
  severity: 'info' | 'success' | 'warning' | 'medium' | 'critical';
  /** The thing this is about — a click lands here, not on a list page. */
  entityType: string;
  entityId: (c: EventContext) => string | undefined;
  /** Stated so it can be tested, and so a reader knows the intent. */
  mustNotReceive: string;
  /** What the recipient is expected to do about it. */
  action: string;
  title: (c: EventContext) => string;
  body: (c: EventContext) => string;
  deepLink: (c: EventContext) => string;
  /** How recipients are found, from the relationship rather than a role list. */
  audience: (c: EventContext) => Promise<string[]>;
}

// ── Recipient resolvers ─────────────────────────────────────────────────────
//
// Each derives its answer from a real relationship. None returns "all admins".

/** Members of the organization that owns this campaign. The outer gate. */
async function orgMembersFor(campaignId: string): Promise<Set<string>> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }, select: { organizationId: true },
  });
  if (!campaign) return new Set();
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: campaign.organizationId }, select: { userId: true },
  });
  return new Set(members.map((m) => m.userId));
}

/**
 * The people actually responsible for this campaign's review.
 *
 * Internal campaign members first — those are the people assigned to the work.
 * Only if nobody is assigned does it fall back to leadership, because an
 * unassigned campaign still cannot go unanswered. It is a fallback, not the
 * default: notifying every OWNER on every comment is how a team learns to
 * ignore the badge.
 */
async function campaignResponsible(campaignId: string): Promise<string[]> {
  const assigned = await prisma.campaignMember.findMany({
    where: { campaignId, isExternal: false, revokedAt: null, userId: { not: null } },
    select: { userId: true },
  });
  const ids = assigned.map((a) => a.userId).filter((v): v is string => Boolean(v));
  if (ids.length > 0) return ids;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }, select: { organizationId: true },
  });
  if (!campaign) return [];
  const leaders = await prisma.organizationMember.findMany({
    where: { organizationId: campaign.organizationId, role: { in: ['OWNER', 'MANAGER'] } },
    select: { userId: true },
  });
  return leaders.map((l) => l.userId);
}

/** Whoever submitted a version — the person waiting on its review. */
async function versionAuthor(versionId?: string): Promise<string[]> {
  if (!versionId) return [];
  const v = await prisma.assetVersion.findUnique({
    where: { id: versionId }, select: { createdByUserId: true },
  });
  return v?.createdByUserId ? [v.createdByUserId] : [];
}

/** The case owner, and whoever opened it. */
async function caseOwners(investigationId?: string): Promise<string[]> {
  if (!investigationId) return [];
  const i = await prisma.incident.findUnique({
    where: { id: investigationId },
    select: { assignedToUserId: true, openedByUserId: true },
  });
  return [i?.assignedToUserId, i?.openedByUserId].filter((v): v is string => Boolean(v));
}

/** Whoever created a handover — the person waiting to hear it landed. */
async function handoverCreator(handoverId?: string): Promise<string[]> {
  if (!handoverId) return [];
  const h = await prisma.campaignHandover.findUnique({
    where: { id: handoverId }, select: { createdByUserId: true },
  });
  return h?.createdByUserId ? [h.createdByUserId] : [];
}

/** Whoever issued a report. */
async function reportIssuer(reportId?: string): Promise<string[]> {
  if (!reportId) return [];
  const r = await prisma.clientReport.findUnique({
    where: { id: reportId }, select: { generatedByUserId: true },
  });
  return r?.generatedByUserId ? [r.generatedByUserId] : [];
}

/**
 * Turn a candidate list into the final recipients.
 *
 * Three rules, applied here so no definition can forget one:
 *   - must be a member of the organization that owns the campaign
 *   - never the actor
 *   - de-duplicated
 */
async function resolve(
  campaignId: string | undefined,
  candidates: (string | null | undefined)[],
  actorUserId?: string | null,
): Promise<string[]> {
  const wanted = [...new Set(candidates.filter((v): v is string => Boolean(v)))]
    .filter((id) => id !== actorUserId);
  if (wanted.length === 0 || !campaignId) return [];

  const allowed = await orgMembersFor(campaignId);
  return wanted.filter((id) => allowed.has(id));
}

// ── The matrix ──────────────────────────────────────────────────────────────

const camp = (c: EventContext) => c.campaignName ?? 'the campaign';
const asset = (c: EventContext) => c.assetName ?? 'an asset';
const who = (c: EventContext) => c.actorLabel ?? 'Someone';

/** Deep links land on the entity, never on a list page. */
const toReview = (c: EventContext) =>
  `/business/campaigns/${c.campaignId}?tab=approvals${c.assetId ? `&asset=${c.assetId}` : ''}`;
const toVersions = (c: EventContext) =>
  `/business/campaigns/${c.campaignId}?tab=versions${c.assetId ? `&asset=${c.assetId}` : ''}`;
const toInvestigation = (c: EventContext) =>
  `/business/campaigns/${c.campaignId}?tab=investigations${c.investigationId ? `&case=${c.investigationId}` : ''}`;
const toFindings = (c: EventContext) =>
  `/business/campaigns/${c.campaignId}?tab=findings${c.findingId ? `&finding=${c.findingId}` : ''}`;
const toHandover = (c: EventContext) =>
  `/business/campaigns/${c.campaignId}?tab=handover${c.handoverId ? `&handover=${c.handoverId}` : ''}`;
const toPeople = (c: EventContext) => `/business/campaigns/${c.campaignId}?tab=people`;
const toRights = (c: EventContext) => `/business/campaigns/${c.campaignId}?tab=rights`;

export const EVENTS: Record<string, EventDefinition> = {
  // ── Review ────────────────────────────────────────────────────────────
  'review.comment_added': {
    trigger: 'Someone left a comment on a version under review.',
    class: 'NOTIFICATION',
    notificationType: 'CAMPAIGN_MESSAGE',
    category: 'sharing',
    severity: 'info',
    entityType: 'asset',
    entityId: (c) => c.assetId,
    mustNotReceive: 'Other campaigns, other organizations, external creators not on this asset.',
    action: 'Read the comment and reply if it needs an answer.',
    title: (c) => `${who(c)} commented on ${asset(c)}`,
    body: (c) => c.detail?.slice(0, 200) ?? `A new comment on ${camp(c)}.`,
    deepLink: toReview,
    // People named in the comment, plus whoever is responsible for the campaign.
    audience: async (c) => resolve(
      c.campaignId,
      [...(c.targetUserIds ?? []), ...(await campaignResponsible(c.campaignId!))],
      c.actorUserId,
    ),
  },

  'review.change_requested': {
    trigger: 'A reviewer asked for changes to a specific version.',
    class: 'NOTIFICATION',
    notificationType: 'SHARE_REJECTED',
    category: 'sharing',
    severity: 'warning',
    entityType: 'version',
    entityId: (c) => c.versionId,
    mustNotReceive: 'Anyone outside this campaign. Other creators on the campaign who did not submit this version.',
    action: 'Address the requested change and submit a new version.',
    title: (c) => `${who(c)} requested changes to Version ${c.versionNumber ?? '?'} of ${asset(c)}`,
    body: (c) => c.detail?.slice(0, 200) ?? `Changes requested on ${camp(c)}.`,
    deepLink: toReview,
    // The person who submitted the version first, then whoever owns the campaign.
    audience: async (c) => resolve(
      c.campaignId,
      [...(await versionAuthor(c.versionId)), ...(await campaignResponsible(c.campaignId!))],
      c.actorUserId,
    ),
  },

  'review.version_approved': {
    trigger: 'A version was approved. Terminal — it will not change again.',
    class: 'NOTIFICATION',
    notificationType: 'SHARE_ACCEPTED',
    category: 'sharing',
    severity: 'success',
    entityType: 'version',
    entityId: (c) => c.versionId,
    mustNotReceive: 'Other campaigns and other organizations.',
    action: 'The version is signed off and can be handed over.',
    title: (c) => `Version ${c.versionNumber ?? '?'} of ${asset(c)} was approved`,
    body: (c) => `${who(c)} approved it. ${camp(c)}.`,
    deepLink: toReview,
    audience: async (c) => resolve(
      c.campaignId,
      [...(await versionAuthor(c.versionId)), ...(await campaignResponsible(c.campaignId!))],
      c.actorUserId,
    ),
  },

  'review.version_submitted': {
    trigger: 'A new version was submitted and review was requested.',
    class: 'NOTIFICATION',
    notificationType: 'CAMPAIGN_MESSAGE',
    category: 'sharing',
    severity: 'info',
    entityType: 'version',
    entityId: (c) => c.versionId,
    mustNotReceive: 'The submitter. Anyone outside the campaign.',
    action: 'Review the new version.',
    title: (c) => `Version ${c.versionNumber ?? '?'} of ${asset(c)} is ready for review`,
    body: (c) => `${who(c)} submitted it. ${camp(c)}.`,
    deepLink: toVersions,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  // ── Creator access ────────────────────────────────────────────────────
  'creator.access_granted': {
    trigger: 'An external creator was given scoped access to specific assets.',
    class: 'ACTIVITY',
    notificationType: 'LINK_CREATED',
    category: 'sharing',
    severity: 'info',
    entityType: 'campaign',
    entityId: (c) => c.campaignId,
    mustNotReceive: 'The creator themselves through this channel. Other organizations.',
    action: 'None — recorded so the team can see who has access.',
    title: (c) => `${c.recipientLabel ?? 'A creator'} was given access to ${camp(c)}`,
    body: (c) => c.detail ?? 'Scoped to specific assets.',
    deepLink: toPeople,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  'creator.access_revoked': {
    trigger: 'An external creator\'s access was withdrawn.',
    class: 'NOTIFICATION',
    notificationType: 'LINK_REVOKED',
    category: 'security',
    severity: 'warning',
    entityType: 'campaign',
    entityId: (c) => c.campaignId,
    mustNotReceive: 'Other organizations. Other creators.',
    action: 'Confirm the withdrawal was intended.',
    title: (c) => `${c.recipientLabel ?? 'A creator'}'s access to ${camp(c)} was revoked`,
    body: (c) => c.detail ?? 'They can no longer open the assets they were sent.',
    deepLink: toPeople,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  // ── Handover ──────────────────────────────────────────────────────────
  'handover.created': {
    trigger: 'A handover was assembled for the client.',
    class: 'ACTIVITY',
    notificationType: 'LINK_CREATED',
    category: 'sharing',
    severity: 'info',
    entityType: 'handover',
    entityId: (c) => c.handoverId,
    mustNotReceive: 'Other campaigns, other organizations, external creators.',
    action: 'None — the milestone is the client opening it.',
    title: (c) => `Handover prepared for ${c.recipientLabel ?? 'the client'}`,
    body: (c) => camp(c),
    deepLink: toHandover,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  'handover.opened': {
    trigger: 'The client opened the handover for the FIRST time.',
    class: 'NOTIFICATION',
    notificationType: 'SHARE_ACCEPTED',
    category: 'sharing',
    severity: 'success',
    entityType: 'handover',
    entityId: (c) => c.handoverId,
    mustNotReceive: 'The whole team — only whoever sent it is waiting on this. Re-opens notify nobody.',
    action: 'The client has the work. Nothing to do unless they come back.',
    title: (c) => `${c.recipientLabel ?? 'The client'} opened the handover`,
    body: (c) => `${camp(c)} — the final assets have been received.`,
    deepLink: toHandover,
    audience: async (c) => resolve(
      c.campaignId, await handoverCreator(c.handoverId), c.actorUserId),
  },

  'handover.revoked': {
    trigger: 'A handover\'s access was withdrawn.',
    class: 'NOTIFICATION',
    notificationType: 'LINK_REVOKED',
    category: 'security',
    severity: 'warning',
    entityType: 'handover',
    entityId: (c) => c.handoverId,
    mustNotReceive: 'The client. Other organizations.',
    action: 'Confirm the client no longer needs the assets, or issue a new handover.',
    title: (c) => `Handover to ${c.recipientLabel ?? 'the client'} was revoked`,
    body: (c) => `${camp(c)} — the link no longer opens.`,
    deepLink: toHandover,
    audience: async (c) => resolve(
      c.campaignId,
      [...(await handoverCreator(c.handoverId)), ...(await campaignResponsible(c.campaignId!))],
      c.actorUserId,
    ),
  },

  // ── Rights ────────────────────────────────────────────────────────────
  'rights.attention_needed': {
    trigger: 'A licence is expiring, expired, or carries a restriction that blocks planned use.',
    class: 'ALERT',
    notificationType: 'RISK_ALERT',
    category: 'security',
    severity: 'warning',
    entityType: 'asset',
    entityId: (c) => c.assetId,
    mustNotReceive: 'Other campaigns and other organizations. Never the client.',
    action: 'Renew or re-license before the work is used again.',
    title: (c) => `Rights need attention on ${asset(c)}`,
    body: (c) => c.detail ?? `${camp(c)} — check the licence before further use.`,
    deepLink: toRights,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  // ── Monitoring and findings ───────────────────────────────────────────
  //
  // There is deliberately NO definition for a scan completing or a scan
  // finding nothing. Those are not events anyone needs told about.
  'monitoring.discovery_confirmed': {
    trigger: 'A high-confidence external copy was discovered by a real provider.',
    class: 'ALERT',
    notificationType: 'PUBLISH_GUARDIAN_DISCOVERY',
    category: 'monitoring',
    severity: 'critical',
    entityType: 'finding',
    entityId: (c) => c.findingId,
    mustNotReceive: 'The client. External creators. Other organizations.',
    action: 'Review the match and decide whether it is your work.',
    title: (c) => `Possible copy of ${asset(c)} found${c.host ? ` on ${c.host}` : ''}`,
    body: (c) => c.similarityPercent
      ? `${c.similarityPercent}% similar. Needs review.`
      : 'Needs review.',
    deepLink: toFindings,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  'finding.confirmed': {
    trigger: 'A person judged a match to be their work.',
    class: 'NOTIFICATION',
    notificationType: 'PUBLISH_GUARDIAN_DISCOVERY',
    category: 'monitoring',
    severity: 'warning',
    entityType: 'finding',
    entityId: (c) => c.findingId,
    mustNotReceive: 'The client. External creators. Other organizations.',
    action: 'Decide whether to open an investigation.',
    title: (c) => `Match confirmed on ${asset(c)}`,
    body: (c) => c.host ? `Confirmed as your work, found on ${c.host}.` : 'Confirmed as your work.',
    deepLink: toFindings,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  'finding.dismissed': {
    trigger: 'A person judged a match to be unrelated.',
    class: 'ACTIVITY',
    notificationType: 'PUBLISH_GUARDIAN_DISCOVERY',
    category: 'monitoring',
    severity: 'info',
    entityType: 'finding',
    entityId: (c) => c.findingId,
    mustNotReceive: 'Everyone — this is a timeline entry, not a badge.',
    action: 'None. Recorded so the decision is auditable.',
    title: (c) => `Match dismissed on ${asset(c)}`,
    body: () => 'Judged unrelated.',
    deepLink: toFindings,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  // ── Investigations ────────────────────────────────────────────────────
  'investigation.assigned': {
    trigger: 'A case was assigned to a specific person.',
    class: 'NOTIFICATION',
    notificationType: 'INVESTIGATION_STARTED',
    category: 'investigation',
    severity: 'info',
    entityType: 'investigation',
    entityId: (c) => c.investigationId,
    mustNotReceive: 'The rest of the team — being handed a case is personal.',
    action: 'Pick the case up.',
    title: (c) => `${c.detail ?? 'A case'} was assigned to you`,
    body: (c) => `${c.caseCode ?? ''} — ${camp(c)}`.trim(),
    deepLink: toInvestigation,
    audience: async (c) => resolve(c.campaignId, c.targetUserIds ?? [], c.actorUserId),
  },

  'investigation.updated': {
    trigger: 'A case changed state — opened, moved, closed or reopened.',
    class: 'NOTIFICATION',
    notificationType: 'CASE_CLOSED',
    category: 'investigation',
    severity: 'info',
    entityType: 'investigation',
    entityId: (c) => c.investigationId,
    mustNotReceive: 'Anyone with no relationship to the case or its campaign.',
    action: 'Check where the case stands.',
    title: (c) => `${c.detail ?? 'A case'} — ${c.status?.toLowerCase() ?? 'updated'}`,
    body: (c) => `${c.caseCode ?? ''} — ${camp(c)}`.trim(),
    deepLink: toInvestigation,
    audience: async (c) => resolve(
      c.campaignId,
      [...(await caseOwners(c.investigationId)), ...(await campaignResponsible(c.campaignId!))],
      c.actorUserId,
    ),
  },

  'investigation.evidence_added': {
    trigger: 'Evidence was collected onto a case.',
    class: 'NOTIFICATION',
    notificationType: 'EVIDENCE_READY',
    category: 'investigation',
    severity: 'info',
    entityType: 'investigation',
    entityId: (c) => c.investigationId,
    mustNotReceive: 'The whole organization — only the people working the case.',
    action: 'Review what was added.',
    title: (c) => `Evidence added to ${c.caseCode ?? 'a case'}`,
    body: (c) => c.detail ?? camp(c),
    deepLink: toInvestigation,
    audience: async (c) => resolve(
      c.campaignId, await caseOwners(c.investigationId), c.actorUserId),
  },

  // ── Client reports ────────────────────────────────────────────────────
  'report.generated': {
    trigger: 'A client report was drafted. Not yet visible to anyone outside the team.',
    class: 'ACTIVITY',
    notificationType: 'REPORT_GENERATED',
    category: 'reports',
    severity: 'info',
    entityType: 'report',
    entityId: (c) => c.reportId,
    mustNotReceive: 'Everyone — a draft is not news until it is issued.',
    action: 'None until it is issued.',
    title: (c) => `Report ${c.reportCode ?? ''} drafted`.trim(),
    body: (c) => camp(c),
    deepLink: toInvestigation,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  'report.issued': {
    trigger: 'A report was issued to the client and its link now opens.',
    class: 'NOTIFICATION',
    notificationType: 'REPORT_SHARED',
    category: 'reports',
    severity: 'success',
    entityType: 'report',
    entityId: (c) => c.reportId,
    mustNotReceive: 'The client through this channel. Other organizations.',
    action: 'Send the client the link if it has not gone out.',
    title: (c) => `Report issued to the client: ${c.detail ?? c.reportCode ?? ''}`.trim(),
    body: (c) => `${c.reportCode ?? ''} — ${camp(c)}`.trim(),
    deepLink: toInvestigation,
    audience: async (c) => resolve(
      c.campaignId, await campaignResponsible(c.campaignId!), c.actorUserId),
  },

  'report.opened_by_client': {
    trigger: 'The client opened an issued report for the FIRST time.',
    class: 'NOTIFICATION',
    notificationType: 'REPORT_DOWNLOADED',
    category: 'reports',
    severity: 'info',
    entityType: 'report',
    entityId: (c) => c.reportId,
    mustNotReceive: 'The team at large. Re-reads notify nobody.',
    action: 'None. The client has seen it.',
    title: (c) => `The client opened ${c.detail ?? c.reportCode ?? 'the report'}`,
    body: (c) => c.reportCode ?? camp(c),
    deepLink: toInvestigation,
    audience: async (c) => resolve(
      c.campaignId, await reportIssuer(c.reportId), c.actorUserId),
  },
};

export type BusinessEvent = keyof typeof EVENTS;

/**
 * Emit a declared business event.
 *
 * Refuses anything not in the matrix — that is what stops a call site inventing
 * a notification. Resolves the audience, then hands one envelope per recipient
 * to the existing engine.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 *
 * The dedupe key is event + entity + recipient, so re-processing the same
 * business event cannot produce a second row. `aggregate` is deliberately NOT
 * set: aggregation merges DIFFERENT occurrences, which is the opposite of what
 * is wanted here.
 */
export async function emitBusinessEvent(
  event: BusinessEvent,
  ctx: EventContext,
): Promise<{ recipients: string[]; skipped: boolean }> {
  const def = EVENTS[event];
  if (!def) {
    logger.warn('[notification-policy] refused undeclared event', { event });
    return { recipients: [], skipped: true };
  }

  let recipients: string[] = [];
  try {
    recipients = await def.audience(ctx);
  } catch (err) {
    logger.warn('[notification-policy] audience resolution failed', {
      event, error: (err as Error).message,
    });
    return { recipients: [], skipped: true };
  }

  if (recipients.length === 0) return { recipients: [], skipped: true };

  /**
   * The entity reference must be internally consistent.
   *
   * A definition names the entity it is about, but the context may not carry
   * that id — a change request raised against an asset with no specific version,
   * say. Falling back to the campaign id while still claiming `entityType:
   * 'version'` produces a reference that points at a campaign and says it is a
   * version, which is worse than a coarser but honest one. So when the specific
   * id is missing, BOTH halves fall back together.
   */
  const specificId = def.entityId(ctx);
  const entityType = specificId ? def.entityType : 'campaign';
  const entityId = specificId ?? ctx.campaignId;
  if (!entityId) {
    logger.warn('[notification-policy] no entity to reference', { event });
    return { recipients: [], skipped: true };
  }

  for (const ownerUserId of recipients) {
    try {
      platformEvents.emit({
        name: event,
        category: def.category,
        severity: def.severity,
        ownerUserId,
        ...(ctx.actorUserId ? { actorUserId: ctx.actorUserId } : {}),
        entityType,
        entityId,
        title: def.title(ctx),
        body: def.body(ctx),
        deepLink: def.deepLink(ctx),
        notificationType: def.notificationType,
        // One row per event per entity per person, forever.
        dedupeKey: `${event}:${entityId}:${ownerUserId}`,
        payload: { notificationClass: def.class },
        skipTimeline: true,
        skipAudit: true,
      });
    } catch (err) {
      // A notification must never break the action that caused it.
      logger.warn('[notification-policy] emit failed', {
        event, ownerUserId, error: (err as Error).message,
      });
    }
  }

  return { recipients, skipped: false };
}

/** The matrix, for documentation and for tests to assert against. */
export function describeMatrix() {
  return Object.entries(EVENTS).map(([event, d]) => ({
    event,
    trigger: d.trigger,
    class: d.class,
    entityType: d.entityType,
    mustNotReceive: d.mustNotReceive,
    action: d.action,
    notificationType: d.notificationType,
  }));
}
