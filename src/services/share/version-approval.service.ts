/**
 * Version approvals — the decision a reviewer records against one version.
 *
 * An approval is an audit claim: "Adhureddy approved version 3 on 25 Aug 2026".
 * Everything here exists to make that claim defensible.
 *
 * Binding is server-side and complete. The chain
 *
 *   token -> ShareLink -> assetId -> Asset.campaignId
 *         -> Campaign(clientId, organizationId) -> AssetVersion
 *
 * is resolved from the token alone. The caller supplies a decision and an
 * optional comment; every identifier on the record is derived, never accepted.
 *
 * The record is insert-only. Nothing in this file, or anywhere else, updates a
 * version_approvals row. A decision is reversed by recording a new one against
 * a new version.
 */
import type { ApprovalDecision } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { logOrgAudit } from '../organization/audit-log.service';
import { emitBusinessEvent } from '../platform-events/notification-policy';
import { resolveReviewContext } from './share-review.service';

/** Statuses a version may be decided from. */
const DECIDABLE = new Set(['IN_REVIEW', 'CHANGES_REQUESTED', 'IN_PROGRESS', 'DRAFT']);

export interface ApprovalEvidence {
  ipAddress?: string | null;
  deviceFingerprint?: string | null;
}

export const versionApprovalService = {
  /**
   * Record a client's decision, reached through a secure review link.
   */
  async decideAsClient(
    token: string,
    input: { decision: ApprovalDecision; comment?: unknown; approverLabel?: unknown },
    evidence: ApprovalEvidence = {},
  ) {
    const ctx = await resolveReviewContext(token);

    // Approval is a separate grant from commenting: it carries weight that a
    // comment does not, so a link that allows discussion does not by that fact
    // allow sign-off.
    const link = await prisma.shareLink.findUnique({
      where: { token },
      select: { allowApproval: true, otpVerified: true, requireOtp: true, shareRecipientId: true },
    });
    if (!link?.allowApproval) {
      throw new AppError(403, 'This link does not allow approving or requesting changes');
    }

    // When the sender required identity verification, the decision cannot be
    // made until it has actually happened. We never silently downgrade it.
    if (link.requireOtp && !link.otpVerified) {
      throw new AppError(403, 'Verify your identity before approving this version');
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: ctx.campaignId },
      select: { id: true, clientId: true, organizationId: true },
    });
    if (!campaign || campaign.organizationId !== ctx.organizationId) {
      throw new AppError(404, 'Review is not available for this link');
    }

    return record({
      organizationId: ctx.organizationId,
      clientId: campaign.clientId,
      campaignId: ctx.campaignId,
      assetId: ctx.assetId,
      versionId: ctx.versionId,
      versionNumber: ctx.versionNumber,
      filename: ctx.filename,
      decision: input.decision,
      comment: cleanComment(input.comment, input.decision),
      approverLabel: label(input.approverLabel, ctx.recipientLabel),
      approvedByUserId: null,
      approvedByRecipientId: link.shareRecipientId ?? ctx.shareLinkId,
      shareToken: token,
      otpVerified: link.otpVerified,
      ...evidence,
    });
  },

  /**
   * Record a decision made by a team member inside the workspace.
   *
   * Kept in the same table and the same code path as the client's, so an
   * internal sign-off is not a second, weaker kind of record.
   */
  async decideAsTeam(
    organizationId: string,
    actorUserId: string,
    versionId: string,
    input: { decision: ApprovalDecision; comment?: unknown },
    evidence: ApprovalEvidence = {},
  ) {
    const { requireOrgRole } = await import('../organization/org-access.service');
    const { OrganizationMemberRole } = await import('../organization/constants/org-rbac');
    // Approving is a manager-level act. A MEMBER can do the work and raise
    // requests, but signing something off is deliberately narrower.
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);

    const version = await prisma.assetVersion.findFirst({
      where: { id: versionId, organizationId },
      select: {
        id: true, versionNumber: true, assetId: true, campaignId: true,
        originalFilename: true, reviewStatus: true,
      },
    });
    if (!version || !version.campaignId) throw new AppError(404, 'Version not found');

    const campaign = await prisma.campaign.findUnique({
      where: { id: version.campaignId },
      select: { clientId: true },
    });

    const actor = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { fullName: true, shortId: true },
    });

    return record({
      organizationId,
      clientId: campaign?.clientId ?? null,
      campaignId: version.campaignId,
      assetId: version.assetId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      filename: version.originalFilename,
      decision: input.decision,
      comment: cleanComment(input.comment, input.decision),
      approverLabel: actor?.fullName || actor?.shortId || 'Team member',
      approvedByUserId: actorUserId,
      approvedByRecipientId: null,
      shareToken: null,
      otpVerified: false,
      ...evidence,
    });
  },

  /** Decisions recorded against one version, newest first. */
  async listForVersion(organizationId: string, versionId: string) {
    const rows = await prisma.versionApproval.findMany({
      where: { versionId, organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(shape);
  },

  /** Every decision in a campaign — the Approvals tab's history. */
  async listForCampaign(organizationId: string, campaignId: string, limit = 50) {
    const rows = await prisma.versionApproval.findMany({
      where: { organizationId, campaignId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(shape);
  },
};

// ── internals ────────────────────────────────────────────────────────────────

function shape(a: {
  id: string; decision: ApprovalDecision; comment: string | null; approverLabel: string;
  approvedByUserId: string | null; approvedByRecipientId: string | null;
  otpVerified: boolean; createdAt: Date; versionId: string; assetId: string;
}) {
  return {
    id: a.id,
    decision: a.decision,
    comment: a.comment,
    approverLabel: a.approverLabel,
    byClient: Boolean(a.approvedByRecipientId),
    identityVerified: a.otpVerified,
    versionId: a.versionId,
    assetId: a.assetId,
    createdAt: a.createdAt.toISOString(),
  };
}

function label(raw: unknown, fallback: string): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return (s || fallback).slice(0, 120);
}

/**
 * A change request without a reason is not actionable, so it is required.
 * An approval may stand on its own.
 */
function cleanComment(raw: unknown, decision: ApprovalDecision): string | null {
  const s = typeof raw === 'string'
    ? raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
    : '';
  if (decision === 'CHANGES_REQUESTED' && !s) {
    throw new AppError(400, 'Say what needs changing, so the team knows what to do');
  }
  if (s.length > 5000) throw new AppError(400, 'That note is too long');
  return s || null;
}

/**
 * Write the decision and move the version, in one transaction.
 *
 * The status change and the record must land together: a version that reads
 * APPROVED with no approval row behind it would be a claim with no evidence.
 */
async function record(input: {
  organizationId: string; clientId: string | null; campaignId: string;
  assetId: string; versionId: string; versionNumber: number; filename: string;
  decision: ApprovalDecision; comment: string | null; approverLabel: string;
  approvedByUserId: string | null; approvedByRecipientId: string | null;
  shareToken: string | null; otpVerified: boolean;
  ipAddress?: string | null; deviceFingerprint?: string | null;
}) {
  const version = await prisma.assetVersion.findUnique({
    where: { id: input.versionId },
    select: { reviewStatus: true, supersededAt: true },
  });
  if (!version) throw new AppError(404, 'Version not found');

  if (version.supersededAt) {
    throw new AppError(409, 'This version has been replaced by a newer one. Review the current version instead.');
  }
  if (version.reviewStatus === 'APPROVED') {
    throw new AppError(409, 'This version is already approved. Changes need a new version.');
  }
  if (!DECIDABLE.has(version.reviewStatus)) {
    throw new AppError(409, `A version that is ${version.reviewStatus.replace(/_/g, ' ').toLowerCase()} cannot be decided.`);
  }

  const nextStatus = input.decision === 'APPROVED' ? 'APPROVED' : 'CHANGES_REQUESTED';

  const created = await prisma.$transaction(async (tx) => {
    const approval = await tx.versionApproval.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        campaignId: input.campaignId,
        assetId: input.assetId,
        versionId: input.versionId,
        decision: input.decision,
        comment: input.comment,
        approverLabel: input.approverLabel,
        approvedByUserId: input.approvedByUserId,
        approvedByRecipientId: input.approvedByRecipientId,
        shareToken: input.shareToken,
        otpVerified: input.otpVerified,
        ipAddress: input.ipAddress ?? null,
        deviceFingerprint: input.deviceFingerprint ?? null,
      },
    });

    await tx.assetVersion.update({
      where: { id: input.versionId },
      data: { reviewStatus: nextStatus },
    });

    return approval;
  });

  const verb = input.decision === 'APPROVED' ? 'approved' : 'requested changes on';
  const title = `${input.approverLabel} ${verb} ${input.filename} (V${input.versionNumber})`;

  // Campaign Activity reads organizationAuditLog.
  await logOrgAudit({
    organizationId: input.organizationId,
    actorUserId: input.approvedByUserId,
    action: input.decision === 'APPROVED' ? 'VERSION_APPROVED' : 'VERSION_CHANGES_REQUESTED',
    entityType: 'campaign',
    entityId: input.campaignId,
    title,
    detail: { versionId: input.versionId, approvalId: created.id },
  });

  // And into the conversation, so the thread reads as one story.
  {
    const { campaignMessageService } = await import('../organization/campaign-message.service');
    await campaignMessageService.postSystem(
      input.organizationId, input.campaignId,
      input.decision === 'APPROVED'
        ? `${input.approverLabel} approved version ${input.versionNumber}.`
        : `${input.approverLabel} requested changes to version ${input.versionNumber}.`,
      { assetId: input.assetId, versionId: input.versionId },
    );
  }

  // The client is not a user of this system, so there is no actor to exclude —
  // the whole responsible team should hear it. Recipients come from the
  // campaign relationship, not from asset.ownerUserId, which was one arbitrary
  // person and missed everyone else working the review.
  await emitBusinessEvent(
    input.decision === 'APPROVED' ? 'review.version_approved' : 'review.change_requested',
    {
      organizationId: input.organizationId,
      campaignId: input.campaignId,
      assetId: input.assetId,
      assetName: input.filename,
      versionId: input.versionId,
      versionNumber: input.versionNumber,
      actorUserId: input.approvedByUserId ?? null,
      actorLabel: input.approverLabel,
      ...(input.comment ? { detail: input.comment } : {}),
    },
  );

  return { approval: shape(created), reviewStatus: nextStatus };
}
