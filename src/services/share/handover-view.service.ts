/**
 * What the client sees when they open a handover.
 *
 * A deliberately small surface: the final assets, the version each one was
 * approved at, who approved it and when, and the certificate that proves the
 * file is what it claims to be. Nothing else about the campaign exists here.
 *
 * Everything the team can see and the client cannot — other assets, unapproved
 * versions, internal comments, the conversation, other clients, member lists,
 * user ids — is excluded by construction rather than filtered afterwards: this
 * service only ever reads the handover's own asset rows.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';

async function resolveHandover(token: string) {
  const handover = await prisma.campaignHandover.findUnique({
    where: { accessToken: token },
    include: { assets: true },
  });

  // Same message for "no such handover" and "not sent yet", so a token cannot
  // be used to discover which handovers exist.
  if (!handover) throw new AppError(404, 'This handover link is not valid');
  if (handover.status === 'DRAFT') throw new AppError(404, 'This handover link is not valid');
  if (handover.status === 'REVOKED') throw new AppError(403, 'This handover has been withdrawn');
  if (handover.expiresAt && handover.expiresAt.getTime() < Date.now()) {
    throw new AppError(403, 'This handover link has expired');
  }
  return handover;
}

export const handoverViewService = {
  async get(token: string) {
    const handover = await resolveHandover(token);

    const assetIds = handover.assets.map((a) => a.assetId);
    const versionIds = handover.assets.map((a) => a.versionId);
    const vaultIds = (await prisma.asset.findMany({
      where: { id: { in: assetIds } }, select: { vaultId: true },
    })).map((a) => a.vaultId).filter((v): v is string => Boolean(v));

    const [assets, versions, certs, approvals, campaign] = await Promise.all([
      prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, originalFilename: true, mimeType: true, assetType: true,
                  sizeBytes: true, vaultId: true },
      }),
      prisma.assetVersion.findMany({
        where: { id: { in: versionIds } },
        select: { id: true, assetId: true, versionNumber: true, reviewStatus: true,
                  createdAt: true, changeSummary: true, dnaRecordId: true },
      }),
      // Same fallback as the rights panel: Certificate.assetId post-dates most
      // certificates, and a client should not be told a protected file has none.
      prisma.certificate.findMany({
        where: { OR: [{ assetId: { in: assetIds } }, { vaultId: { in: vaultIds } }] },
        select: { assetId: true, vaultId: true, certificateId: true, status: true, issuedAt: true },
      }),
      // Only the decision itself — never the internal user id behind it.
      prisma.versionApproval.findMany({
        where: { versionId: { in: versionIds }, decision: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        select: { versionId: true, approverLabel: true, createdAt: true, comment: true },
      }),
      prisma.campaign.findUnique({
        where: { id: handover.campaignId },
        select: { name: true },
      }),
    ]);

    const assetById = new Map(assets.map((a) => [a.id, a]));
    const versionById = new Map(versions.map((v) => [v.id, v]));
    const certByAsset = new Map<string, (typeof certs)[number]>();
    for (const c of certs) if (c.assetId) certByAsset.set(c.assetId, c);
    const certByVault = new Map(certs.map((c) => [c.vaultId, c]));
    const approvalByVersion = new Map(approvals.map((a) => [a.versionId, a]));

    // Record the open before returning, so the team sees receipt even if the
    // client closes the page immediately.
    const { campaignHandoverService } = await import('../organization/campaign-handover.service');
    await campaignHandoverService.recordOpen(handover.id).catch(() => {});

    return {
      title: handover.title ?? 'Final assets',
      note: handover.note,
      campaignName: campaign?.name ?? '',
      recipientLabel: handover.recipientLabel,
      handedOverAt: handover.sentAt ? handover.sentAt.toISOString() : handover.createdAt.toISOString(),
      expiresAt: handover.expiresAt ? handover.expiresAt.toISOString() : null,
      assets: handover.assets.map((ha) => {
        const asset = assetById.get(ha.assetId);
        const version = versionById.get(ha.versionId);
        const cert = certByAsset.get(ha.assetId)
          ?? (asset?.vaultId ? certByVault.get(asset.vaultId) : undefined);
        const approval = approvalByVersion.get(ha.versionId);
        return {
          filename: asset?.originalFilename ?? 'Removed asset',
          assetType: asset?.assetType ?? null,
          sizeBytes: asset?.sizeBytes ?? 0,
          versionNumber: version?.versionNumber ?? null,
          changeSummary: version?.changeSummary ?? null,
          approvedBy: approval?.approverLabel ?? null,
          approvedAt: approval?.createdAt ? approval.createdAt.toISOString() : null,
          approvalNote: approval?.comment ?? null,
          certificateId: cert?.certificateId ?? null,
          certificateStatus: cert?.status ?? null,
          certificateIssuedAt: cert?.issuedAt ? cert.issuedAt.toISOString() : null,
          /** Whether this file is protected — shown as a fact, not an id. */
          protected: Boolean(version?.dnaRecordId),
          /** The scoped link for opening this one file. */
          viewToken: ha.shareToken,
        };
      }),
    };
  },
};
