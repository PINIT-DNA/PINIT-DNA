/**
 * Build intelligence report payload for a vault (shared by user + super-admin APIs).
 */
import { prisma } from '../../lib/prisma';
import { SYSTEM_VERSION } from '../../config/dna-versions';
import { toPublicCameraForensics } from '../forensics/prnu-camera.service';
import type { CameraForensicsStored } from '../../types/camera-forensics.types';
import { parseOriginalCaptureExif, readPinitProtect } from './original-capture-exif';

export async function buildIntelligenceReportPayload(vaultId: string) {
  const vault = await prisma.vaultRecord.findUnique({
    where: { id: vaultId },
    include: {
      dnaRecord: {
        include: {
          cryptoLayer: true,
          metadataLayer: true,
          perceptualLayer: true,
          stegoLayer: true,
          ocrRecord: true,
          verifications: { orderBy: { createdAt: 'desc' }, take: 1 },
          monitorRecords: {
            include: {
              crawlResults: { orderBy: { createdAt: 'desc' }, take: 20 },
              monitoringRuns: { orderBy: { startedAt: 'desc' }, take: 5 },
            },
          },
        },
      },
    },
  });

  if (!vault) return null;

  const dna = vault.dnaRecord;

  const shareLinks = await prisma.shareLink.findMany({
    where: { vaultId },
    include: { accessLogs: { orderBy: { createdAt: 'desc' }, take: 100 } },
  });

  const evidence = await prisma.evidenceRecord.findMany({
    where: { dnaRecordId: dna.id },
    orderBy: { createdAt: 'desc' },
  });

  const owner = dna.ownerUserId
    ? await prisma.user.findUnique({
        where: { id: dna.ownerUserId },
        select: { id: true, shortId: true, fullName: true },
      })
    : null;

  const asset = await prisma.asset.findFirst({
    where: {
      OR: [{ vaultId }, { dnaId: dna.id }],
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const identity = {
    ownerUserId: owner?.shortId ?? 'PINIT-UNKNOWN',
    uploaderId: owner?.shortId ?? 'PINIT-UNKNOWN',
    pinitId: owner?.shortId ?? null,
    assetId: asset?.id ?? null,
    mfid: vault.id,
    dnaRecordId: dna.id,
    filename: vault.originalFileName,
    mimeType: vault.originalMimeType,
    fileSize: vault.originalSizeBytes,
    encryptedSize: vault.encryptedSizeBytes,
    fileType: dna.fileType ?? 'IMAGE',
    encryptionAlgorithm: vault.encryptionAlgorithm,
    engineVersion: dna.engineVersion ?? SYSTEM_VERSION,
  };

  const meta = dna.metadataLayer;
  const originalCapture = parseOriginalCaptureExif(meta?.exifData);
  const pinitProtect = readPinitProtect(meta?.exifData);
  const allAccessLogs = shareLinks
    .flatMap((l) => l.accessLogs)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const geoAccess = allAccessLogs.find((l) => l.country) ?? allAccessLogs[0] ?? null;
  const gpsAccess = allAccessLogs.find((l) => l.gpsLat !== null) ?? null;
  const lastAccess = allAccessLogs.length ? allAccessLogs[allAccessLogs.length - 1] : null;
  const protectLocation = pinitProtect?.placeName
    || [pinitProtect?.village, pinitProtect?.city, pinitProtect?.state, pinitProtect?.country].filter(Boolean).join(', ')
    || null;
  const protectGps = pinitProtect?.gpsLatitude != null && pinitProtect?.gpsLongitude != null
    ? { lat: pinitProtect.gpsLatitude, lng: pinitProtect.gpsLongitude }
    : originalCapture.gpsLatitude == null && meta?.gpsLatitude != null && meta?.gpsLongitude != null
      ? { lat: meta.gpsLatitude, lng: meta.gpsLongitude }
      : null;

  const provenance = {
    uploadedAt: dna.createdAt.toISOString(),
    vaultedAt: vault.createdAt.toISOString(),
    capturedAt: originalCapture.capturedAt,
    gpsLatitude: originalCapture.gpsLatitude,
    gpsLongitude: originalCapture.gpsLongitude,
    accessGpsLat: gpsAccess?.gpsLat ?? null,
    accessGpsLng: gpsAccess?.gpsLng ?? null,
    accessGpsCity: gpsAccess?.gpsCity ?? null,
    country: geoAccess?.country ?? null,
    city: geoAccess?.city ?? null,
    deviceModel: originalCapture.cameraModel,
    deviceMake: originalCapture.cameraMake,
    software: originalCapture.software,
    timezone: originalCapture.timezone,
    captureMethod: pinitProtect?.captureMethod ?? null,
    imageWidth: originalCapture.width ?? dna.imageWidthPx ?? pinitProtect?.width ?? null,
    imageHeight: originalCapture.height ?? dna.imageHeightPx ?? pinitProtect?.height ?? null,
    gpsAccuracy: null as number | null,
    originalCapture,
    protection: {
      protectedBy: owner?.fullName ?? null,
      pinitId: owner?.shortId ?? null,
      protectedAt: vault.createdAt.toISOString(),
      dnaGeneratedAt: dna.createdAt.toISOString(),
      vaultStoredAt: vault.createdAt.toISOString(),
      vaultId: vault.id,
      method: pinitProtect?.captureMethod ?? null,
      locationLabel: protectLocation || null,
      locationGps: protectGps,
      gpsAccuracy: pinitProtect?.gpsAccuracy ?? null,
      timezone: pinitProtect?.timezone ?? null,
      encryption: vault.encryptionAlgorithm,
      watermarkPresent: Boolean(dna.stegoLayer?.embedded),
      metadataPreserved: originalCapture.metadataPreserved,
    },
    lastAccess: lastAccess
      ? {
          at: lastAccess.createdAt.toISOString(),
          action: lastAccess.action,
          city: lastAccess.city ?? lastAccess.gpsCity ?? null,
          country: lastAccess.country ?? null,
          gpsLat: lastAccess.gpsLat ?? null,
          gpsLng: lastAccess.gpsLng ?? null,
        }
      : null,
  };

  const lastVerif = dna.verifications[0];
  const sha256 = dna.cryptoLayer?.sha256Hash ?? dna.sha256Hash ?? null;
  let tamperStatus = 'UNVERIFIED';
  if (lastVerif) tamperStatus = lastVerif.passed ? 'VERIFIED' : 'TAMPERED';

  const integrity = {
    sha256Hash: sha256,
    normalizedHash: dna.cryptoLayer?.normalizedHash ?? null,
    dnaStatus: dna.status,
    layersComplete: 6,
    tamperStatus,
    lastVerification: lastVerif
      ? {
          passed: lastVerif.passed,
          confidenceScore: lastVerif.confidenceScore,
          at: lastVerif.createdAt.toISOString(),
        }
      : null,
  };

  const monitor = dna.monitorRecords[0] ?? null;
  const allResults = dna.monitorRecords.flatMap((m) => m.crawlResults);
  const matches = allResults.filter((r) => r.matchType !== 'NO_MATCH');

  const discovery = {
    monitoringActive: monitor?.status === 'ACTIVE',
    scanType: monitor?.scanType ?? null,
    totalRuns: dna.monitorRecords.reduce((s, m) => s + m.monitoringRuns.length, 0),
    totalMatches: monitor?.totalMatches ?? 0,
    exactMatches: matches.filter((r) => r.matchType === 'EXACT_MATCH' || r.matchType === 'DUPLICATE').length,
    highMatches: matches.filter((r) => r.matchType === 'HIGH_MATCH' || r.matchType === 'NEAR_MATCH').length,
    possibleMatches: matches.filter((r) => r.matchType === 'POSSIBLE_MATCH' || r.matchType === 'POSSIBLE').length,
    recentMatches: matches.slice(0, 5).map((r) => ({
      url: r.url,
      matchType: r.matchType,
      similarity: r.similarity,
      foundAt: r.createdAt.toISOString(),
    })),
    ocrIndexed: dna.ocrRecord?.indexed ?? false,
    ocrWordCount: dna.ocrRecord?.wordCount ?? 0,
    ocrLanguage: dna.ocrRecord?.language ?? null,
  };

  const allLogs = shareLinks.flatMap((l) => l.accessLogs);
  const countries = [...new Set(allLogs.map((l) => l.country).filter(Boolean))] as string[];
  const devices = [...new Set(allLogs.map((l) => l.device).filter(Boolean))] as string[];
  const browsers = [...new Set(allLogs.map((l) => l.browser).filter(Boolean))] as string[];
  const recipients = [...new Set(allLogs.map((l) => l.recipientName).filter(Boolean))] as string[];

  const distribution = {
    totalShareLinks: shareLinks.length,
    activeLinks: shareLinks.filter((l) => l.isActive).length,
    totalViews: shareLinks.reduce((s, l) => s + l.viewCount, 0),
    totalDownloads: shareLinks.reduce((s, l) => s + l.downloadCount, 0),
    totalEvents: allLogs.length,
    uniqueCountries: countries,
    uniqueDevices: devices,
    uniqueBrowsers: browsers,
    recipients: recipients.slice(0, 20),
    timeline: allLogs
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 30)
      .map((l) => ({
        action: l.action,
        at: l.createdAt.toISOString(),
        country: l.country ?? null,
        device: l.device ?? null,
        browser: l.browser ?? null,
        riskLevel: l.riskLevel ?? null,
      })),
  };

  const highRiskEvents = allLogs.filter((l) => l.riskLevel === 'HIGH' || l.riskLevel === 'CRITICAL').length;
  const avgRiskScore =
    allLogs.length > 0
      ? Math.round(allLogs.reduce((s, l) => s + (l.riskScore ?? 0), 0) / allLogs.length)
      : 0;
  const leakIndicators: string[] = [];
  if (discovery.exactMatches > 0) leakIndicators.push(`${discovery.exactMatches} exact match(es) found online`);
  if (discovery.highMatches > 0) leakIndicators.push(`${discovery.highMatches} high-similarity match(es) online`);
  if (highRiskEvents > 0) leakIndicators.push(`${highRiskEvents} high-risk access event(s)`);
  if (distribution.totalDownloads > 10) leakIndicators.push('High download volume detected');

  const overallRisk =
    leakIndicators.length >= 3
      ? 'CRITICAL'
      : leakIndicators.length === 2
        ? 'HIGH'
        : leakIndicators.length === 1
          ? 'MEDIUM'
          : avgRiskScore > 50
            ? 'MEDIUM'
            : 'LOW';

  const risk = {
    riskScore: Math.max(avgRiskScore, leakIndicators.length * 25),
    riskLevel: overallRisk,
    evidenceCount: evidence.length,
    suspiciousEvents: highRiskEvents,
    leakIndicators,
    recentEvidence: evidence.slice(0, 5).map((e) => ({
      code: e.evidenceCode,
      type: e.evidenceType,
      description: e.description,
      at: e.createdAt.toISOString(),
    })),
  };

  const cameraForensics = toPublicCameraForensics(
    dna.cameraForensics as CameraForensicsStored | null,
  );

  return {
    generatedAt: new Date().toISOString(),
    vaultId,
    identity,
    provenance,
    integrity,
    discovery,
    distribution,
    risk,
    cameraForensics,
    owner: owner ? { id: owner.id, shortId: owner.shortId, fullName: owner.fullName } : null,
  };
}
