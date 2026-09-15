/**
 * Business Account — Asset versions.
 *
 * A logical deliverable (Asset) accumulates immutable revisions (AssetVersion).
 * V1 -> V2 -> V3, and no version is ever rewritten: each one carries its own
 * dnaRecordId / vaultId / certificateId, so creating a new version is an INSERT
 * and the previous version's protection columns are never touched.
 *
 * That is the whole point of the feature. A client reviewing V2 must not be able
 * to change what V1 was, or the DNA record certifies nothing.
 *
 * Tenancy follows the business layer (organizationId) rather than
 * Asset.ownerUserId, matching Campaign. See
 * docs/BUSINESS_CLIENT_COLLABORATION_BLUEPRINT.md section A.1.
 */
import type { Prisma, ReviewStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { emitBusinessEvent } from '../platform-events/notification-policy';
import { VaultService } from '../vault/vault.service';

const vaultService = new VaultService();

/**
 * Legal review transitions.
 *
 * Spec §14: "Do not allow arbitrary invalid transitions." In particular
 * APPROVED is terminal — an approved version is never edited in place; the way
 * forward from APPROVED is to create a NEW version, which starts at DRAFT.
 * SUPERSEDED is likewise terminal: it is set by the system when a later version
 * takes over, and nothing moves out of it.
 */
const ALLOWED_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  DRAFT:             ['IN_REVIEW', 'SUPERSEDED'],
  IN_REVIEW:         ['CHANGES_REQUESTED', 'APPROVED', 'SUPERSEDED'],
  CHANGES_REQUESTED: ['IN_PROGRESS', 'IN_REVIEW', 'SUPERSEDED'],
  IN_PROGRESS:       ['IN_REVIEW', 'SUPERSEDED'],
  APPROVED:          ['SUPERSEDED'],
  SUPERSEDED:        [],
};

export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Load an asset and prove it belongs to this organization via its campaign. */
async function loadAssetScoped(organizationId: string, assetId: string) {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: {
      id: true, originalFilename: true, mimeType: true, sizeBytes: true,
      contentHash: true, dnaId: true, vaultId: true, certificateId: true,
      campaignId: true, ownerUserId: true, createdAt: true,
      campaign: { select: { id: true, organizationId: true, name: true } },
    },
  });
  if (!asset) throw new AppError(404, 'Asset not found');

  // An asset reaches an organization only through its campaign. An asset with no
  // campaign is a personal/individual asset and is not addressable here — that
  // keeps Individual mode entirely outside this feature.
  if (!asset.campaign || asset.campaign.organizationId !== organizationId) {
    throw new AppError(404, 'Asset not found');
  }
  return asset;
}

function shape(v: {
  id: string; versionNumber: number; reviewStatus: ReviewStatus;
  originalFilename: string; mimeType: string; sizeBytes: number;
  dnaRecordId: string | null; vaultId: string | null; certificateId: string | null;
  contentHash: string | null; changeSummary: string | null;
  createdByUserId: string; createdAt: Date; supersededAt: Date | null;
}) {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    reviewStatus: v.reviewStatus,
    originalFilename: v.originalFilename,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    dnaRecordId: v.dnaRecordId,
    vaultId: v.vaultId,
    certificateId: v.certificateId,
    contentHash: v.contentHash,
    changeSummary: v.changeSummary,
    createdByUserId: v.createdByUserId,
    createdAt: v.createdAt.toISOString(),
    supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null,
    isProtected: Boolean(v.dnaRecordId && v.vaultId),
  };
}

export const assetVersionService = {
  /**
   * Adopt an asset that predates versioning as its own V1.
   *
   * Deliberately lazy rather than a bulk backfill migration: it writes only when
   * someone actually opens an asset, it is idempotent through the
   * (assetId, versionNumber) unique index, and it never runs a mass UPDATE over
   * a database that has already been lost once.
   *
   * V1 is created as APPROVED-neutral DRAFT — it makes no claim about whether
   * anyone reviewed it, because nobody did; the review workflow did not exist.
   */
  // `_actorUserId` is unused here on purpose: authorisation is enforced by the
  // caller (list/createVersion both requireOrgRole first), and the parameter is
  // kept so every method in this service reads with the same signature.
  async ensureV1(organizationId: string, _actorUserId: string, assetId: string) {
    const asset = await loadAssetScoped(organizationId, assetId);

    const existing = await prisma.assetVersion.findFirst({
      where: { assetId },
      orderBy: { versionNumber: 'asc' },
    });
    if (existing) return existing;

    try {
      return await prisma.assetVersion.create({
        data: {
          assetId,
          versionNumber: 1,
          organizationId,
          campaignId: asset.campaignId,
          dnaRecordId: asset.dnaId,
          vaultId: asset.vaultId,
          certificateId: asset.certificateId,
          contentHash: asset.contentHash,
          originalFilename: asset.originalFilename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          reviewStatus: 'DRAFT',
          changeSummary: 'Initial version',
          createdByUserId: asset.ownerUserId,
          // Preserve the asset's real creation time — this version is not new
          // work, it is a record of what already existed.
          createdAt: asset.createdAt,
        },
      });
    } catch (err) {
      // Concurrent first-open: the unique index won. Read the winner.
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        const winner = await prisma.assetVersion.findFirst({
          where: { assetId }, orderBy: { versionNumber: 'asc' },
        });
        if (winner) return winner;
      }
      throw err;
    }
  },

  async list(organizationId: string, actorUserId: string, assetId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    await this.ensureV1(organizationId, actorUserId, assetId);

    const versions = await prisma.assetVersion.findMany({
      where: { assetId },
      orderBy: { versionNumber: 'desc' },
    });
    const current = versions.find((v) => !v.supersededAt) ?? versions[0] ?? null;

    return {
      versions: versions.map(shape),
      currentVersionId: current?.id ?? null,
      currentVersionNumber: current?.versionNumber ?? null,
    };
  },

  async get(organizationId: string, actorUserId: string, versionId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const version = await prisma.assetVersion.findFirst({
      where: { id: versionId, organizationId },
    });
    if (!version) throw new AppError(404, 'Version not found');
    return shape(version);
  },

  /**
   * Decrypt and return the vaulted bytes for this version.
   *
   * Vault retrieve is owner-bound. After org/campaign scope is proven here, we
   * load the vault owner's id from the record (same pattern as share-link and
   * Exchange bridge) so a campaign reviewer can open the file they are reviewing
   * without being the original uploader.
   */
  async getFile(organizationId: string, actorUserId: string, versionId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const version = await prisma.assetVersion.findFirst({
      where: { id: versionId, organizationId },
    });
    if (!version) throw new AppError(404, 'Version not found');
    if (!version.vaultId) {
      throw new AppError(404, 'This version has no file in the vault yet');
    }

    const vault = await prisma.vaultRecord.findUnique({
      where: { id: version.vaultId },
      include: { dnaRecord: { select: { ownerUserId: true } } },
    });
    const ownerUserId = vault?.dnaRecord?.ownerUserId;
    if (!vault || !ownerUserId) {
      throw new AppError(404, 'The file for this version is not available');
    }

    const result = await vaultService.retrieve(version.vaultId, ownerUserId);
    return {
      buffer: result.originalBuffer,
      mimeType: version.mimeType || result.originalMimeType || 'application/octet-stream',
      filename: version.originalFilename || result.originalFileName || 'file',
    };
  },

  /**
   * Register a newly protected file as the next version of an existing asset.
   *
   * The file itself is protected by the normal vault/DNA pipeline BEFORE this is
   * called — this method does not upload, encrypt or fingerprint anything. It
   * records the result as V(n+1) and marks V(n) superseded, in one transaction
   * so a crash can never leave two live versions or an orphaned supersede.
   */
  async createVersion(
    organizationId: string,
    actorUserId: string,
    assetId: string,
    input: {
      dnaRecordId?: string | null;
      vaultId?: string | null;
      certificateId?: string | null;
      contentHash?: string | null;
      originalFilename: string;
      mimeType?: string;
      sizeBytes?: number;
      changeSummary?: string;
    },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const asset = await loadAssetScoped(organizationId, assetId);
    await this.ensureV1(organizationId, actorUserId, assetId);

    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.assetVersion.findFirst({
        where: { assetId },
        orderBy: { versionNumber: 'desc' },
      });
      const nextNumber = (latest?.versionNumber ?? 0) + 1;

      const version = await tx.assetVersion.create({
        data: {
          assetId,
          versionNumber: nextNumber,
          organizationId,
          campaignId: asset.campaignId,
          dnaRecordId: input.dnaRecordId ?? null,
          vaultId: input.vaultId ?? null,
          certificateId: input.certificateId ?? null,
          contentHash: input.contentHash ?? null,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType ?? 'application/octet-stream',
          sizeBytes: input.sizeBytes ?? 0,
          reviewStatus: 'DRAFT',
          changeSummary: input.changeSummary ?? null,
          createdByUserId: actorUserId,
        },
      });

      // Supersede the previous version. Only status/pointer columns change —
      // its dnaRecordId, vaultId, certificateId and contentHash are untouched,
      // which is what keeps the old version verifiable forever.
      if (latest && !latest.supersededAt) {
        await tx.assetVersion.update({
          where: { id: latest.id },
          data: { supersededAt: new Date(), supersededById: version.id, reviewStatus: 'SUPERSEDED' },
        });
      }
      return version;
    });

    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'ASSET_VERSION_CREATED',
      entityType: 'campaign',
      entityId: asset.campaignId ?? assetId,
      title: `Version ${created.versionNumber} of ${asset.originalFilename} uploaded`,
    });

    // Put it in the conversation too, so a client watching the thread learns a
    // new version exists without being told separately.
    if (asset.campaignId) {
      const { campaignMessageService } = await import('./campaign-message.service');
      await campaignMessageService.postSystem(
        organizationId, asset.campaignId,
        `Version ${created.versionNumber} of ${asset.originalFilename} was uploaded.`,
        { assetId, versionId: created.id },
      );
    }

    // A new version is a request for someone's time — the people responsible
    // for this campaign's review, and never the person who just uploaded it.
    await emitBusinessEvent('review.version_submitted', {
      organizationId,
      ...(asset.campaignId ? { campaignId: asset.campaignId } : {}),
      assetId,
      assetName: asset.originalFilename,
      versionId: created.id,
      versionNumber: created.versionNumber,
      actorUserId,
      ...(input.changeSummary ? { detail: input.changeSummary } : {}),
    });

    return shape(created);
  },

  /**
   * Move a version through the review lifecycle, refusing invalid jumps.
   */
  async setReviewStatus(
    organizationId: string,
    actorUserId: string,
    versionId: string,
    next: ReviewStatus,
    opts: { note?: string } = {},
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);

    const version = await prisma.assetVersion.findFirst({
      where: { id: versionId, organizationId },
    });
    if (!version) throw new AppError(404, 'Version not found');

    if (version.reviewStatus === next) return shape(version);

    if (!canTransition(version.reviewStatus, next)) {
      throw new AppError(
        409,
        `A version that is ${version.reviewStatus.replace(/_/g, ' ').toLowerCase()} ` +
        `cannot move to ${next.replace(/_/g, ' ').toLowerCase()}. ` +
        (version.reviewStatus === 'APPROVED'
          ? 'Create a new version instead — an approved version is never changed.'
          : 'Check the review state and try again.'),
      );
    }

    const updated = await prisma.assetVersion.update({
      where: { id: versionId },
      data: { reviewStatus: next },
    });

    await logOrgAudit({
      organizationId,
      actorUserId,
      action: `VERSION_${next}`,
      entityType: 'campaign',
      entityId: version.campaignId ?? version.assetId,
      title: opts.note
        ?? `Version ${version.versionNumber} of ${version.originalFilename} → ${next.replace(/_/g, ' ').toLowerCase()}`,
    });

    return shape(updated);
  },
};
