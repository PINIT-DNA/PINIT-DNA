/**
 * Investigations — case management over the EXISTING Incident model.
 *
 * There is no second investigation architecture here. The crawler already opens
 * an Incident on a match, EvidenceRecord already hangs off it, and
 * AssetDiscovery already carries `investigationId`. This service adds what a
 * case needs on top of that: a title, an owner, a campaign, a lifecycle, and a
 * written record of what people did.
 *
 * Two boundaries the code keeps deliberately:
 *
 *   1. A note is not evidence. EvidenceRecord is a collected artefact with
 *      integrity information; IncidentNote is a person's account. Merging them
 *      would let commentary be shown to a client as evidence.
 *
 *   2. Terminal is terminal. RESOLVED and DISMISSED cannot be edited back out
 *      of by the ordinary status call — reopening is its own operation, needs a
 *      reason, and leaves a note. The same reasoning that makes an approved
 *      version and a decided finding terminal.
 *
 * A case is never described as proof of infringement. It is a record of what
 * was found and what the team did about it.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { emitBusinessEvent } from '../platform-events/notification-policy';

export type InvestigationStatus =
  | 'OPEN'
  | 'INVESTIGATING'
  | 'AWAITING_CLIENT'
  | 'RESOLVED'
  | 'DISMISSED';

export type InvestigationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const TERMINAL: InvestigationStatus[] = ['RESOLVED', 'DISMISSED'];

const PRIORITIES: InvestigationPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * What each state means, in the words a person would use.
 *
 * OPEN is the engine's existing default, so every incident the crawler has ever
 * raised is already a valid case without a backfill.
 */
const STATUS_MEANING: Record<InvestigationStatus, string> = {
  OPEN: 'Raised, nobody working it yet.',
  INVESTIGATING: 'Someone is actively working this.',
  AWAITING_CLIENT: 'Waiting on a decision from the client.',
  RESOLVED: 'Closed with an outcome recorded.',
  DISMISSED: 'Closed as not warranting action.',
};

/** Forward moves only. Terminal states are absent from every right-hand side. */
const ALLOWED_TRANSITIONS: Record<InvestigationStatus, InvestigationStatus[]> = {
  OPEN: ['INVESTIGATING', 'AWAITING_CLIENT', 'RESOLVED', 'DISMISSED'],
  INVESTIGATING: ['AWAITING_CLIENT', 'RESOLVED', 'DISMISSED'],
  AWAITING_CLIENT: ['INVESTIGATING', 'RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
};

function isStatus(v: string): v is InvestigationStatus {
  return v in ALLOWED_TRANSITIONS;
}

/** A short, human case reference. Not a database id — safe to show a client. */
function newCaseCode(): string {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `INV-${stamp}-${rand}`;
}

async function loadCampaignScoped(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, name: true, clientId: true },
  });
  if (!campaign) throw new AppError(404, 'Campaign not found');
  return campaign;
}

/**
 * Prove a case belongs to this organization before anything touches it.
 *
 * Two routes, because incidents predate campaign scoping: a case created here
 * carries organizationId directly, while one the crawler raised is reachable
 * through its campaign. Never trust an organizationId from the caller.
 */
async function loadCaseScoped(organizationId: string, investigationId: string) {
  const incident = await prisma.incident.findUnique({ where: { id: investigationId } });
  if (!incident) throw new AppError(404, 'Investigation not found');

  if (incident.organizationId && incident.organizationId === organizationId) return incident;

  if (incident.campaignId) {
    const owned = await prisma.campaign.findFirst({
      where: { id: incident.campaignId, organizationId },
      select: { id: true },
    });
    if (owned) return incident;
  }

  throw new AppError(404, 'Investigation not found');
}

/** Display name for a note author, without leaking a full email into the record. */
async function authorLabelFor(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, email: true },
  });
  if (user?.fullName) return user.fullName;
  if (user?.email) return user.email.split('@')[0] ?? 'Team member';
  return 'Team member';
}

/** Record a state change in the timeline so the case reads in order. */
async function systemNote(incidentId: string, body: string) {
  await prisma.incidentNote.create({
    data: { incidentId, authorLabel: 'System', body, isSystem: true },
  });
}

function shape(i: {
  id: string; incidentCode: string; title: string | null; description: string;
  severity: string; status: string; triggerType: string;
  campaignId: string | null; assetId: string | null; findingId: string | null;
  assignedToUserId: string | null; createdAt: Date; updatedAt: Date;
  resolvedAt: Date | null; resolvedNote: string | null; closedAt: Date | null;
}) {
  const status = (isStatus(i.status) ? i.status : 'OPEN') as InvestigationStatus;
  return {
    id: i.id,
    caseCode: i.incidentCode,
    title: i.title ?? i.description.slice(0, 120),
    description: i.description,
    priority: i.severity as InvestigationPriority,
    status,
    statusMeaning: STATUS_MEANING[status],
    isTerminal: TERMINAL.includes(status),
    openedBecause: i.triggerType,
    campaignId: i.campaignId,
    assetId: i.assetId,
    findingId: i.findingId,
    assignedToUserId: i.assignedToUserId,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    resolution: i.resolvedNote,
    closedAt: i.closedAt?.toISOString() ?? null,
  };
}

export const campaignInvestigationService = {
  /** The lifecycle, for a UI that should not hardcode it. */
  vocabulary() {
    return {
      statuses: (Object.keys(ALLOWED_TRANSITIONS) as InvestigationStatus[]).map((s) => ({
        id: s, meaning: STATUS_MEANING[s], terminal: TERMINAL.includes(s),
      })),
      priorities: PRIORITIES,
    };
  },

  /**
   * Open a case.
   *
   * From a finding when one is given — the finding must already be CONFIRMED,
   * because investigating something nobody has judged to be your work is how a
   * team wastes a week. Otherwise a case can be raised directly against a
   * campaign, which is what a client complaint or an off-platform sighting is.
   */
  async create(
    organizationId: string,
    actorUserId: string,
    input: {
      campaignId: string;
      title: string;
      description?: string;
      priority?: InvestigationPriority;
      findingId?: string;
      assetId?: string;
      assignedToUserId?: string;
    },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const campaign = await loadCampaignScoped(organizationId, input.campaignId);

    const title = input.title?.trim();
    if (!title) throw new AppError(400, 'A case needs a title');
    if (title.length > 200) throw new AppError(400, 'Title is too long (200 characters max)');

    const priority = input.priority ?? 'MEDIUM';
    if (!PRIORITIES.includes(priority)) throw new AppError(400, 'Unknown priority');

    let assetId = input.assetId ?? null;
    let dnaRecordId: string | null = null;

    // A finding roots the case in something real: the asset, its DNA record and
    // the source URL all come from the discovery rather than from the caller.
    if (input.findingId) {
      const finding = await prisma.assetDiscovery.findUnique({
        where: { id: input.findingId },
        select: {
          id: true, url: true, alertStatus: true, investigationId: true,
          asset: { select: { id: true, dnaId: true, campaignId: true } },
        },
      });
      if (!finding?.asset || finding.asset.campaignId !== campaign.id) {
        throw new AppError(404, 'Finding not found');
      }
      if (finding.alertStatus !== 'CONFIRMED') {
        throw new AppError(
          409,
          'Confirm this match as your work before opening an investigation on it.',
        );
      }
      if (finding.investigationId) {
        throw new AppError(409, 'This finding already has an investigation.');
      }
      assetId = finding.asset.id;
      dnaRecordId = finding.asset.dnaId;
    } else if (assetId) {
      const asset = await prisma.asset.findFirst({
        where: { id: assetId, campaignId: campaign.id },
        select: { id: true, dnaId: true },
      });
      if (!asset) throw new AppError(404, 'Asset not found in this campaign');
      dnaRecordId = asset.dnaId;
    }

    // An assignee must actually be on this organization, or the case has an
    // owner who cannot open it.
    if (input.assignedToUserId) {
      const member = await prisma.organizationMember.findFirst({
        where: { organizationId, userId: input.assignedToUserId },
        select: { id: true },
      });
      if (!member) throw new AppError(400, 'That person is not a member of this organization');
    }

    const created = await prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          incidentCode: newCaseCode(),
          title,
          description: input.description?.trim() || title,
          severity: priority,
          status: 'OPEN',
          triggerType: input.findingId ? 'FINDING_ESCALATED' : 'MANUAL',
          organizationId,
          campaignId: campaign.id,
          assetId,
          dnaRecordId,
          findingId: input.findingId ?? null,
          openedByUserId: actorUserId,
          assignedToUserId: input.assignedToUserId ?? null,
        },
      });

      // Close the loop the findings layer already anticipated.
      if (input.findingId) {
        await tx.assetDiscovery.update({
          where: { id: input.findingId },
          data: { investigationId: incident.id },
        });
      }

      await tx.incidentNote.create({
        data: {
          incidentId: incident.id,
          authorLabel: 'System',
          isSystem: true,
          body: input.findingId ? 'Case opened from a confirmed match.' : 'Case opened.',
        },
      });

      return incident;
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'INVESTIGATION_OPENED',
      entityType: 'campaign', entityId: campaign.id,
      title: `Investigation opened: ${title}`,
      detail: { caseCode: created.incidentCode, findingId: input.findingId ?? null, priority },
    });

    await emitBusinessEvent('investigation.updated', {
      organizationId,
      campaignId: campaign.id,
      campaignName: campaign.name,
      investigationId: created.id,
      caseCode: created.incidentCode,
      detail: title,
      status: 'opened',
      actorUserId,
    });

    return shape(created);
  },

  /** Cases for a campaign, newest first. */
  async listForCampaign(
    organizationId: string,
    actorUserId: string,
    campaignId: string,
    filter: { status?: InvestigationStatus } = {},
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const campaign = await loadCampaignScoped(organizationId, campaignId);

    const rows = await prisma.incident.findMany({
      where: { campaignId: campaign.id, ...(filter.status ? { status: filter.status } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    const all = filter.status
      ? await prisma.incident.findMany({
          where: { campaignId: campaign.id }, select: { status: true },
        })
      : rows.map((r) => ({ status: r.status }));

    const count = (s: InvestigationStatus) => all.filter((r) => r.status === s).length;

    return {
      campaignName: campaign.name,
      investigations: rows.map(shape),
      counts: {
        total: all.length,
        open: count('OPEN'),
        investigating: count('INVESTIGATING'),
        awaitingClient: count('AWAITING_CLIENT'),
        resolved: count('RESOLVED'),
        dismissed: count('DISMISSED'),
        active: all.filter((r) => !TERMINAL.includes(r.status as InvestigationStatus)).length,
      },
      vocabulary: campaignInvestigationService.vocabulary(),
    };
  },

  /**
   * One case in full: the timeline, the evidence already collected, and the
   * finding it came from.
   */
  async get(organizationId: string, actorUserId: string, investigationId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const incident = await loadCaseScoped(organizationId, investigationId);

    const [notes, evidence, asset, finding, assignee] = await Promise.all([
      prisma.incidentNote.findMany({
        where: { incidentId: incident.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true, authorLabel: true, body: true, isSystem: true },
      }),
      // Facts about the evidence, never its storage path.
      prisma.evidenceRecord.findMany({
        where: { incidentId: incident.id },
        orderBy: { collectedAt: 'desc' },
        select: {
          id: true, evidenceCode: true, evidenceType: true,
          description: true, hash: true, collectedAt: true,
        },
      }),
      incident.assetId
        ? prisma.asset.findUnique({
            where: { id: incident.assetId },
            select: {
              id: true, originalFilename: true,
              dnaId: true, vaultId: true, certificateId: true,
            },
          })
        : Promise.resolve(null),
      incident.findingId
        ? prisma.assetDiscovery.findUnique({
            where: { id: incident.findingId },
            select: { id: true, url: true, platform: true, similarity: true, firstSeen: true },
          })
        : Promise.resolve(null),
      incident.assignedToUserId
        ? prisma.user.findUnique({
            where: { id: incident.assignedToUserId },
            select: { id: true, fullName: true },
          })
        : Promise.resolve(null),
    ]);

    const status = (isStatus(incident.status) ? incident.status : 'OPEN') as InvestigationStatus;

    return {
      ...shape(incident),
      assignee: assignee ? { id: assignee.id, name: assignee.fullName ?? 'Team member' } : null,
      nextStatuses: ALLOWED_TRANSITIONS[status],
      timeline: notes.map((n) => ({
        id: n.id,
        at: n.createdAt.toISOString(),
        author: n.authorLabel,
        body: n.body,
        isSystem: n.isSystem,
      })),
      evidence: evidence.map((e) => ({
        id: e.id,
        code: e.evidenceCode,
        type: e.evidenceType,
        description: e.description,
        /** Short prefix only — enough to compare, not enough to reconstruct. */
        integrity: e.hash ? `${e.hash.slice(0, 12)}…` : null,
        collectedAt: e.collectedAt.toISOString(),
      })),
      asset: asset
        ? {
            id: asset.id,
            filename: asset.originalFilename,
            hasDna: Boolean(asset.dnaId),
            hasVault: Boolean(asset.vaultId),
            hasCertificate: Boolean(asset.certificateId),
          }
        : null,
      finding: finding
        ? {
            id: finding.id,
            url: finding.url,
            platform: finding.platform,
            similarity: finding.similarity,
            firstSeen: finding.firstSeen.toISOString(),
          }
        : null,
    };
  },

  /** Add a note to the working record. */
  async addNote(
    organizationId: string,
    actorUserId: string,
    investigationId: string,
    body: string,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const incident = await loadCaseScoped(organizationId, investigationId);

    const text = body?.trim();
    if (!text) throw new AppError(400, 'A note needs something in it');
    if (text.length > 4000) throw new AppError(400, 'Note is too long (4000 characters max)');

    // A closed case still accepts notes — someone learning something after the
    // fact should be able to record it without reopening the case.
    const note = await prisma.incidentNote.create({
      data: {
        incidentId: incident.id,
        authorUserId: actorUserId,
        authorLabel: await authorLabelFor(actorUserId),
        body: text,
      },
    });

    return {
      id: note.id,
      at: note.createdAt.toISOString(),
      author: note.authorLabel,
      body: note.body,
      isSystem: false,
    };
  },

  /**
   * Move a case along its lifecycle.
   *
   * Refuses to move out of a terminal state. Reopening exists, but it is a
   * separate deliberate act — see `reopen`.
   */
  async setStatus(
    organizationId: string,
    actorUserId: string,
    investigationId: string,
    next: InvestigationStatus,
    resolution?: string,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const incident = await loadCaseScoped(organizationId, investigationId);

    const current = (isStatus(incident.status) ? incident.status : 'OPEN') as InvestigationStatus;
    if (!isStatus(next)) throw new AppError(400, 'Unknown status');

    if (TERMINAL.includes(current)) {
      throw new AppError(
        409,
        `This case was already ${current.toLowerCase()}. `
        + 'Reopen it deliberately if it needs more work.',
      );
    }
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new AppError(409, `A case cannot go from ${current} to ${next}.`);
    }

    const closing = TERMINAL.includes(next);
    const text = resolution?.trim();
    if (next === 'RESOLVED' && !text) {
      throw new AppError(400, 'Say what the outcome was before resolving the case.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.incident.update({
        where: { id: incident.id },
        data: {
          status: next,
          ...(closing
            ? {
                closedAt: new Date(),
                closedByUserId: actorUserId,
                resolvedAt: new Date(),
                resolvedNote: text ?? null,
              }
            : {}),
        },
      });
      await tx.incidentNote.create({
        data: {
          incidentId: incident.id,
          authorLabel: 'System',
          isSystem: true,
          body: text
            ? `Status changed from ${current} to ${next} — ${text}`
            : `Status changed from ${current} to ${next}.`,
        },
      });
      return row;
    });

    if (incident.campaignId) {
      await logOrgAudit({
        organizationId, actorUserId,
        action: closing ? 'INVESTIGATION_CLOSED' : 'INVESTIGATION_STATUS_CHANGED',
        entityType: 'campaign', entityId: incident.campaignId,
        title: `Investigation ${incident.incidentCode} moved to ${next}`,
        detail: { from: current, to: next, resolution: text ?? null },
      });
    }

    if (closing && incident.campaignId) {
      await emitBusinessEvent('investigation.updated', {
        organizationId,
        campaignId: incident.campaignId,
        investigationId: incident.id,
        caseCode: incident.incidentCode,
        detail: incident.title ?? incident.incidentCode,
        status: next,
        actorUserId,
      });
    }

    return shape(updated);
  },

  /**
   * Reopen a closed case.
   *
   * Deliberately not part of `setStatus`: needing a distinct call, a MANAGER,
   * and a written reason is what stops a terminal state being undone by a
   * mis-click on a dropdown.
   */
  async reopen(
    organizationId: string,
    actorUserId: string,
    investigationId: string,
    reason: string,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const incident = await loadCaseScoped(organizationId, investigationId);

    const current = (isStatus(incident.status) ? incident.status : 'OPEN') as InvestigationStatus;
    if (!TERMINAL.includes(current)) {
      throw new AppError(409, 'This case is not closed.');
    }
    const text = reason?.trim();
    if (!text) throw new AppError(400, 'Say why this case is being reopened.');

    const label = await authorLabelFor(actorUserId);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.incident.update({
        where: { id: incident.id },
        // The original resolution is kept, not erased — the history of the
        // first closure is part of the record.
        data: { status: 'INVESTIGATING', closedAt: null, closedByUserId: null },
      });
      await tx.incidentNote.create({
        data: {
          incidentId: incident.id,
          authorLabel: label,
          authorUserId: actorUserId,
          isSystem: true,
          body: `Case reopened from ${current} — ${text}`,
        },
      });
      return row;
    });

    if (incident.campaignId) {
      await logOrgAudit({
        organizationId, actorUserId,
        action: 'INVESTIGATION_REOPENED',
        entityType: 'campaign', entityId: incident.campaignId,
        title: `Investigation ${incident.incidentCode} reopened`,
        detail: { from: current, reason: text },
      });
    }

    if (incident.campaignId) {
      await emitBusinessEvent('investigation.updated', {
        organizationId,
        campaignId: incident.campaignId,
        investigationId: incident.id,
        caseCode: incident.incidentCode,
        detail: incident.title ?? incident.incidentCode,
        status: 'reopened',
        actorUserId,
      });
    }

    return shape(updated);
  },

  /** Assign or unassign the case owner. */
  async assign(
    organizationId: string,
    actorUserId: string,
    investigationId: string,
    assigneeUserId: string | null,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const incident = await loadCaseScoped(organizationId, investigationId);

    let label = 'nobody';
    if (assigneeUserId) {
      const member = await prisma.organizationMember.findFirst({
        where: { organizationId, userId: assigneeUserId },
        select: { id: true },
      });
      if (!member) throw new AppError(400, 'That person is not a member of this organization');
      label = await authorLabelFor(assigneeUserId);
    }

    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: { assignedToUserId: assigneeUserId },
    });
    await systemNote(incident.id, assigneeUserId ? `Assigned to ${label}.` : 'Assignment cleared.');

    if (assigneeUserId && incident.campaignId) {
      await emitBusinessEvent('investigation.assigned', {
        organizationId,
        campaignId: incident.campaignId,
        investigationId: incident.id,
        caseCode: incident.incidentCode,
        detail: incident.title ?? incident.incidentCode,
        actorUserId,
        // Addressed to the assignee alone; the policy still checks org membership.
        targetUserIds: [assigneeUserId],
      });
    }

    return shape(updated);
  },

  /** Change the priority of an open case. */
  async setPriority(
    organizationId: string,
    actorUserId: string,
    investigationId: string,
    priority: InvestigationPriority,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const incident = await loadCaseScoped(organizationId, investigationId);

    if (!PRIORITIES.includes(priority)) throw new AppError(400, 'Unknown priority');
    if (TERMINAL.includes(incident.status as InvestigationStatus)) {
      throw new AppError(409, 'This case is closed.');
    }

    const updated = await prisma.incident.update({
      where: { id: incident.id }, data: { severity: priority },
    });
    await systemNote(incident.id, `Priority changed from ${incident.severity} to ${priority}.`);

    return shape(updated);
  },
};
