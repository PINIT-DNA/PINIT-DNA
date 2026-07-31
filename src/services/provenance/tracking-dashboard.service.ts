/**
 * Per-vault tracking dashboard data (Protected Download / TEP).
 */
import { prisma } from '../../lib/prisma';
import { getLocationStatusForAssets } from '../forensics/forensic-provenance.service';
import { loadEvidenceTimeline, loadDownloadHistory } from './timeline.service';
import { buildChainOfCustody } from './chain-of-custody.service';
import { PROTECTED_DOWNLOAD_TEP_PREFIX } from '../tep/tep.service';

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
  const [timeline, downloads, custody, teps, locationMap] = await Promise.all([
    loadEvidenceTimeline({ dnaRecordId, vaultId: vault.id }),
    loadDownloadHistory({ dnaRecordId, vaultId: vault.id }),
    buildChainOfCustody({ dnaRecordId, vaultId: vault.id }),
    prisma.trackedExportPackage.findMany({
      where: { vaultId: vault.id },
      orderBy: { createdAt: 'desc' },
    }),
    getLocationStatusForAssets([dnaRecordId]),
  ]);
  const location = locationMap.get(dnaRecordId) ?? { status: 'UNAVAILABLE' as const };

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
    location,
  };
}

export type ProtectedFileShareItem = {
  kind: 'file_open' | 'protected_download';
  id: string;
  tepCode: string | null;
  token: string | null;
  vaultId: string;
  dnaRecordId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  viewCount: number;
  downloadCount: number;
  geoCountry: string | null;
  geoCity: string | null;
  ipAddress: string | null;
  deviceContext: string | null;
  recipientEmail: string | null;
  createdAt: string;
  expiresAt: string | null;
  rediscoveredAt: string | null;
  lastViewedAt: string | null;
};

/**
 * Owner-wide Share File tracking:
 * - FILE open links (open on PinIT page → VIEWED logs)
 * - protected-download TEPs (raw export packages)
 */
export async function listOwnerProtectedFileShares(ownerUserId: string): Promise<ProtectedFileShareItem[]> {
  const vaults = await prisma.vaultRecord.findMany({
    where: { dnaRecord: { ownerUserId } },
    select: {
      id: true,
      originalFileName: true,
      originalMimeType: true,
      originalSizeBytes: true,
    },
  });

  const vaultMap = new Map(vaults.map((v) => [v.id, v]));
  const vaultIds = vaults.map((v) => v.id);

  const [fileLinks, packages] = await Promise.all([
    prisma.shareLink.findMany({
      where: {
        ownerUserId,
        linkType: 'FILE',
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        accessLogs: {
          where: { action: 'VIEWED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }),
    vaultIds.length === 0
      ? Promise.resolve([])
      : prisma.trackedExportPackage.findMany({
          where: {
            vaultId: { in: vaultIds },
            shareLinkId: { startsWith: PROTECTED_DOWNLOAD_TEP_PREFIX },
          },
          orderBy: { createdAt: 'desc' },
          take: 300,
        }),
  ]);

  const openItems: ProtectedFileShareItem[] = fileLinks.map((link) => {
    const lastView = link.accessLogs[0] ?? null;
    return {
      kind: 'file_open',
      id: link.id,
      tepCode: null,
      token: link.token,
      vaultId: link.vaultId,
      dnaRecordId: link.dnaRecordId,
      filename: link.filename || vaultMap.get(link.vaultId)?.originalFileName || 'Unknown file',
      mimeType: link.mimeType || vaultMap.get(link.vaultId)?.originalMimeType || null,
      sizeBytes: vaultMap.get(link.vaultId)?.originalSizeBytes ?? null,
      status: link.isActive ? 'ACTIVE' : 'REVOKED',
      viewCount: link.viewCount,
      downloadCount: link.downloadCount,
      geoCountry: lastView?.country ?? null,
      geoCity: lastView?.city ?? null,
      ipAddress: lastView?.ipAddress ?? null,
      deviceContext: lastView?.device ?? lastView?.browser ?? null,
      recipientEmail: link.recipientEmail,
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt?.toISOString() ?? null,
      rediscoveredAt: null,
      lastViewedAt: lastView?.createdAt?.toISOString() ?? null,
    };
  });

  const tepItems: ProtectedFileShareItem[] = packages.map((p) => {
    const vault = vaultMap.get(p.vaultId);
    return {
      kind: 'protected_download',
      id: p.id,
      tepCode: p.tepCode,
      token: null,
      vaultId: p.vaultId,
      dnaRecordId: p.dnaRecordId,
      filename: vault?.originalFileName ?? 'Unknown file',
      mimeType: vault?.originalMimeType ?? null,
      sizeBytes: vault?.originalSizeBytes ?? null,
      status: p.status,
      viewCount: 0,
      downloadCount: 0,
      geoCountry: p.geoCountry,
      geoCity: p.geoCity,
      ipAddress: p.ipAddress,
      deviceContext: p.deviceContext,
      recipientEmail: p.recipientEmail,
      createdAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt?.toISOString() ?? null,
      rediscoveredAt: p.rediscoveredAt?.toISOString() ?? null,
      lastViewedAt: null,
    };
  });

  return [...openItems, ...tepItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
