/**
 * Per-vault tracking dashboard data (Protected Download / TEP).
 */
import { prisma } from '../../lib/prisma';
import { loadEvidenceTimeline, loadDownloadHistory } from './timeline.service';
import { buildChainOfCustody } from './chain-of-custody.service';

export async function getVaultTrackingDashboard(params: {
  vaultId: string;
  ownerUserId: string;
}) {
  const vault = await prisma.vaultRecord.findFirst({
    where: {
      id: params.vaultId,
      dnaRecord: { ownerUserId: params.ownerUserId },
    },
    include: {
      dnaRecord: {
        select: {
          id: true,
          imageFilename: true,
          ownerUser: { select: { shortId: true, fullName: true } },
        },
      },
    },
  });

  if (!vault) {
    return null;
  }

  const dnaRecordId = vault.dnaRecordId;
  const [timeline, downloads, custody, teps] = await Promise.all([
    loadEvidenceTimeline({ dnaRecordId, vaultId: vault.id }),
    loadDownloadHistory({ dnaRecordId, vaultId: vault.id }),
    buildChainOfCustody({ dnaRecordId, vaultId: vault.id }),
    prisma.trackedExportPackage.findMany({
      where: { vaultId: vault.id },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const activeTeps = teps.filter((t) => t.status === 'ACTIVE');
  const revokedTeps = teps.filter((t) => t.status === 'REVOKED');

  return {
    vaultId: vault.id,
    dnaRecordId,
    filename: vault.originalFileName,
    owner: vault.dnaRecord.ownerUser,
    status: revokedTeps.length && !activeTeps.length ? 'REVOKED' : activeTeps.length ? 'PROTECTED' : 'STORED',
    tepPackages: teps.map((t) => ({
      tepCode: t.tepCode,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt?.toISOString() ?? null,
      geoCountry: t.geoCountry,
      geoCity: t.geoCity,
      recipientId: t.recipientId,
      recipientEmail: t.recipientEmail,
    })),
    downloads: downloads.map((d) => ({
      id: d.id,
      timestamp: d.timestamp,
      summary: d.summary,
      locationLabel: d.locationLabel,
      device: d.device,
      tepCode: d.tepCode,
      actorLabel: d.actorLabel,
      country: d.country,
      city: d.city,
    })),
    summary: timeline.summary,
    chainOfCustody: custody,
    events: timeline.events,
  };
}
