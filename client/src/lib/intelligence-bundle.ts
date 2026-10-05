import { format } from 'date-fns';
import { API_BASE_URL } from '../config/api.config';
import { api, getDnaRecord, getVaultContentAnalysis, getVaultRecord, getVaultTracking, listCertificates, listMyHubCredentials, type VaultTrackingDashboard } from '../services/dashboard.api';
import { getAssetTracking, getOwnerActivity, type ActivityEvent, type AssetTracking } from '../services/tracking.api';
import type { VaultContentAnalysis, VaultRecord } from '../types/dashboard.types';
import { getVaultFileTypeDisplay } from './file-type-utils';
import { vaultSourceCaption } from './source-platform';

export type SourceKind = 'recorded' | 'derived' | 'ai' | 'verified' | 'unavailable';

export type IntelFact = {
  label: string;
  value: string;
  source: SourceKind;
  copy?: string;
};

export type IntelEvent = {
  at: string;
  title: string;
  detail: string;
  category: string;
};

export type IntelLayer = {
  key: string;
  name: string;
  present: boolean;
  note: string;
};

export type IntelView = {
  generatedAt: string;
  vaultId: string;
  filename: string;
  mimeType: string;
  fileTypeLabel: string;
  ownerName: string | null;
  ownerShortId: string | null;
  assetId: string | null;
  dnaId: string;
  originId: string;
  previewVaultId: string;
  firstSeen: string;
  lastActivity: string | null;
  captureSource: string | null;
  dnaStatus: string;
  tamperStatus: string;
  tamperLabel: string;
  authenticityLabel: string;
  aiLabel: string;
  identity: IntelFact[];
  capture: IntelFact[];
  content: {
    summary: string | null;
    verdict: string | null;
    reasons: string[];
    composition: VaultContentAnalysis['composition'] | null;
    ocrWords: number;
    ocrLanguage: string | null;
    analyzed: boolean;
  };
  environment: IntelFact[];
  protection: IntelFact[];
  journey: IntelEvent[];
  exposure: {
    views: number;
    shares: number;
    downloads: number;
    verifications: number;
    matches: number;
    countries: string[];
    devices: string[];
    recipients: string[];
    events: IntelEvent[];
    matchesList: Array<{ url: string; matchType: string; similarity: number; foundAt: string }>;
  };
  investigations: IntelEvent[];
  layers: IntelLayer[];
  camera: {
    present: boolean;
    disclaimer: string;
    conclusion: string;
    facts: IntelFact[];
  };
  snapshot: string;
  leakIndicators: string[];
  evidence: Array<{ code: string; type: string; description: string; at: string }>;
  report: IntelReportPayload;
};

export type IntelReportPayload = {
  generatedAt: string;
  vaultId: string;
  identity: {
    ownerUserId: string;
    uploaderId: string;
    pinitId?: string | null;
    assetId?: string | null;
    mfid: string;
    dnaRecordId: string;
    filename: string;
    mimeType: string;
    fileSize: number;
    encryptedSize: number;
    fileType: string;
    encryptionAlgorithm?: string;
    engineVersion: string;
  };
  provenance: {
    uploadedAt: string;
    vaultedAt: string;
    capturedAt: string | null;
    gpsLatitude: number | null;
    gpsLongitude: number | null;
    accessGpsLat: number | null;
    accessGpsLng: number | null;
    accessGpsCity: string | null;
    country: string | null;
    city: string | null;
    deviceModel: string | null;
    deviceMake?: string | null;
    software: string | null;
    timezone?: string | null;
    captureMethod?: string | null;
    imageWidth?: number | null;
    imageHeight?: number | null;
    gpsAccuracy?: number | null;
    originalCapture?: {
      capturedAt: string | null;
      timezone: string | null;
      gpsLatitude: number | null;
      gpsLongitude: number | null;
      gpsAltitude: number | null;
      cameraMake: string | null;
      cameraModel: string | null;
      lens: string | null;
      focalLength: string | null;
      exposureTime: string | null;
      aperture: string | null;
      iso: string | null;
      flash: string | null;
      orientation: string | null;
      software: string | null;
      width: number | null;
      height: number | null;
      whiteBalance: string | null;
      meteringMode: string | null;
      exposureProgram: string | null;
      colorSpace: string | null;
      sceneCaptureType: string | null;
      lightSource: string | null;
      metadataPreserved: boolean;
    };
    protection?: {
      protectedBy: string | null;
      pinitId: string | null;
      protectedAt: string;
      dnaGeneratedAt: string;
      vaultStoredAt: string;
      vaultId: string;
      method: string | null;
      locationLabel: string | null;
      locationGps: { lat: number; lng: number } | null;
      gpsAccuracy: number | null;
      timezone: string | null;
      encryption: string;
      watermarkPresent: boolean;
      metadataPreserved: boolean;
    };
    lastAccess?: {
      at: string;
      action: string;
      city: string | null;
      country: string | null;
      gpsLat: number | null;
      gpsLng: number | null;
    } | null;
  };
  integrity: {
    sha256Hash: string | null;
    normalizedHash: string | null;
    dnaStatus: string;
    layersComplete: number;
    tamperStatus: string;
    lastVerification: { passed: boolean; confidenceScore: number; at: string } | null;
  };
  discovery: {
    monitoringActive: boolean;
    scanType: string | null;
    totalRuns: number;
    totalMatches: number;
    exactMatches: number;
    highMatches: number;
    possibleMatches: number;
    recentMatches: { url: string; matchType: string; similarity: number; foundAt: string }[];
    ocrIndexed: boolean;
    ocrWordCount: number;
    ocrLanguage: string | null;
  };
  distribution: {
    totalShareLinks: number;
    activeLinks: number;
    totalViews: number;
    totalDownloads: number;
    totalEvents: number;
    uniqueCountries: string[];
    uniqueDevices: string[];
    uniqueBrowsers: string[];
    recipients: string[];
    timeline: { action: string; at: string; country: string | null; device: string | null; browser: string | null; riskLevel: string | null }[];
  };
  risk: {
    riskScore: number;
    riskLevel: string;
    evidenceCount: number;
    suspiciousEvents: number;
    leakIndicators: string[];
    recentEvidence: { code: string; type: string; description: string; at: string }[];
  };
  cameraForensics?: {
    version: 1;
    fingerprintId: string | null;
    correlation: number | null;
    quality: number;
    qualityStatus: string;
    dim: number;
    sameCameraCandidates: Array<{ dnaRecordId: string; fingerprintId: string; correlation: number }>;
    enrolledNewProfile: boolean;
    disclaimer: string;
    processedAt: string;
    residualStored: boolean;
  } | null;
  owner?: { id: string; shortId: string; fullName: string } | null;
};

function fmtBytes(n: number) {
  if (!n && n !== 0) return 'Unavailable';
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
}

function fmtWhen(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, 'd MMM yyyy, h:mm a');
}

function shortId(v?: string | null) {
  if (!v) return null;
  if (v.length < 20) return v;
  return `${v.slice(0, 10)}…${v.slice(-8)}`;
}

function fact(label: string, value: string | null | undefined, source: SourceKind, copy?: string): IntelFact {
  if (!value || !String(value).trim()) return { label, value: 'Not recorded', source: 'unavailable' };
  return { label, value: String(value), source, copy };
}

function factExif(label: string, value: string | null | undefined, copy?: string): IntelFact {
  if (!value || !String(value).trim()) {
    return { label, value: 'Not available in original metadata', source: 'unavailable' };
  }
  return { label, value: String(value), source: 'recorded', copy };
}

export async function fetchIntelReportPayload(vaultId: string, adminMode = false): Promise<IntelReportPayload> {
  const url = adminMode
    ? `${API_BASE_URL}/super-admin/vault/${vaultId}/intelligence`
    : `${API_BASE_URL}/intelligence/report/${vaultId}`;
  const { data } = await api.get<IntelReportPayload & { success?: boolean; report?: IntelReportPayload }>(url);
  if ((data as { report?: IntelReportPayload }).report) return (data as { report: IntelReportPayload }).report;
  return data as IntelReportPayload;
}

export async function fetchIntelView(vaultId: string, adminMode = false): Promise<IntelView> {
  const report = await fetchIntelReportPayload(vaultId, adminMode);
  const extras = await Promise.allSettled([
    getVaultRecord(vaultId),
    getVaultTracking(vaultId),
    getVaultContentAnalysis(vaultId),
    getDnaRecord(report.identity.dnaRecordId),
    api.get<{ links?: Array<{ token?: string; viewCount?: number; downloadCount?: number; createdAt?: string; isActive?: boolean }> }>(
      `${API_BASE_URL}/share/vault/${vaultId}`,
    ),
    listCertificates(),
    getOwnerActivity(),
    api.get<{ certificates?: Array<{ certificateId: string }> }>(`${API_BASE_URL}/certificates/dna/${report.identity.dnaRecordId}`),
    listMyHubCredentials(),
  ]);

  const vault = extras[0].status === 'fulfilled' ? (extras[0].value as VaultRecord) : null;
  const tracking = extras[1].status === 'fulfilled' ? extras[1].value : null;
  const analysisSnap = extras[2].status === 'fulfilled' ? extras[2].value : null;
  const dna = extras[3].status === 'fulfilled' ? extras[3].value : null;
  const shareLinks = extras[4].status === 'fulfilled'
    ? (extras[4].value.data.links ?? [])
    : [];
  const certs = extras[5].status === 'fulfilled' ? extras[5].value : [];
  const activity = extras[6].status === 'fulfilled' ? extras[6].value : null;
  const certsByDna = extras[7].status === 'fulfilled' ? (extras[7].value.data.certificates ?? []) : [];
  const hubCreds = extras[8].status === 'fulfilled' ? extras[8].value.credentials : [];

  let assetTrack: AssetTracking | null = null;
  const canonicalId = vault?.assetId;
  if (canonicalId) {
    try {
      assetTrack = await getAssetTracking(canonicalId);
    } catch {
      assetTrack = null;
    }
  }

  return buildIntelView({
    report,
    vault,
    tracking,
    analysis: analysisSnap?.contentAnalysis ?? vault?.contentAnalysis ?? null,
    dna,
    shareLinks,
    certificateId:
      certsByDna[0]?.certificateId
      ?? assetTrack?.certificate?.certificateId
      ?? certs.find((c) => c.vaultId === vaultId || c.dnaRecordId === report.identity.dnaRecordId)?.certificateId
      ?? hubCreds.find((c) =>
        c.source?.type === 'PINIT_CERTIFICATE'
        && (
          c.relatedAsset?.href?.includes(vaultId)
          || c.relatedAsset?.id === canonicalId
        ),
      )?.source.id
      ?? null,
    activityEvents: activity?.files.find((f) => f.vaultIds.includes(vaultId) || f.dnaIds.includes(report.identity.dnaRecordId))?.events ?? [],
    investigationCount: assetTrack?.evidence.investigations ?? tracking?.summary.investigationCount ?? 0,
  });
}

export function buildIntelView(input: {
  report: IntelReportPayload;
  vault: VaultRecord | null;
  tracking: VaultTrackingDashboard | null;
  analysis: VaultContentAnalysis | null;
  dna: Awaited<ReturnType<typeof getDnaRecord>> | null;
  shareLinks: Array<{ token?: string; viewCount?: number; downloadCount?: number; createdAt?: string; isActive?: boolean }>;
  certificateId: string | null;
  activityEvents: ActivityEvent[];
  investigationCount: number;
}): IntelView {
  const r = input.report;
  const vault = input.vault;
  const tracking = input.tracking;
  const analysis = input.analysis;
  const dna = input.dna;
  const ownerName = r.owner?.fullName || tracking?.owner?.fullName || null;
  const ownerShortId = r.owner?.shortId || tracking?.owner?.shortId || r.identity.pinitId || r.identity.ownerUserId || null;
  const assetId = r.identity.assetId || vault?.assetId || null;
  const originId = assetId || r.identity.mfid || r.vaultId;
  const oc = r.provenance.originalCapture;
  const prot = r.provenance.protection;
  const lastAccess = r.provenance.lastAccess;
  const captureTime = oc?.capturedAt ?? r.provenance.capturedAt;
  const lastShare = r.distribution.timeline.length
    ? r.distribution.timeline[r.distribution.timeline.length - 1]?.at ?? null
    : null;
  const lastActivity = tracking?.summary.lastDownload || tracking?.summary.lastProtectedExport || lastShare;
  const rawTamper = String(r.integrity.tamperStatus || '').toUpperCase();
  const verdict = analysis?.verdictDisplay || analysis?.labelDisplay || null;
  const verdictPending = !verdict || /unverified|not yet|pending/i.test(verdict);
  const tamperLabel =
    rawTamper === 'TAMPERED'
      ? 'Tampered'
      : rawTamper === 'VERIFIED'
        ? 'Authentic'
        : 'Not independently re-checked';
  const authenticityLabel = verdictPending
    ? (rawTamper === 'VERIFIED' ? 'Verified original' : 'Protected')
    : verdict;
  const aiProb = analysis?.scores?.aiProbability;
  const aiLabel =
    analysis?.verdict === 'AI_GENERATED' || analysis?.signals?.likelyAiGenerated
      ? 'AI generation signals present'
      : typeof aiProb === 'number'
        ? `AI probability ${Math.round(aiProb <= 1 ? aiProb * 100 : aiProb)}%`
        : verdictPending
          ? 'Not run yet'
          : 'No manipulation recorded';

  const img = dna?.image as { widthPx?: number; heightPx?: number; sizeBytes?: number; mimeType?: string } | undefined;
  const layersFlag = (dna?.layers ?? {}) as Record<string, boolean>;
  const source = vault ? vaultSourceCaption(vault) : null;

  const identity: IntelFact[] = [
    fact('Asset ID', assetId, 'recorded', assetId ?? undefined),
    fact('PINIT ID', r.identity.pinitId || ownerShortId, 'recorded', (r.identity.pinitId || ownerShortId) ?? undefined),
    fact('Vault ID', r.vaultId, 'recorded', r.vaultId),
    fact('Origin ID', originId, 'recorded', originId),
    fact('DNA ID', r.identity.dnaRecordId, 'recorded', r.identity.dnaRecordId),
    fact('Certificate ID', input.certificateId, 'recorded', input.certificateId ?? undefined),
    fact('SHA-256', r.integrity.sha256Hash, 'derived', r.integrity.sha256Hash ?? undefined),
    fact('Perceptual hash', r.integrity.normalizedHash, 'derived', r.integrity.normalizedHash ?? undefined),
    fact('Structural hash', layersFlag.structural ? 'Registered with DNA record' : null, layersFlag.structural ? 'derived' : 'unavailable'),
  ];

  const captureGps = oc?.gpsLatitude != null && oc?.gpsLongitude != null
    ? `${oc.gpsLatitude.toFixed(5)}, ${oc.gpsLongitude.toFixed(5)}${oc.gpsAltitude != null ? ` · ${Math.round(oc.gpsAltitude)}m` : ''}`
    : null;
  const capture: IntelFact[] = [
    fact('Original filename', r.identity.filename, 'recorded'),
    factExif('Capture date/time', fmtWhen(captureTime)),
    factExif('Time zone', oc?.timezone ?? null),
    factExif('Capture location', captureGps),
    factExif('Camera manufacturer', oc?.cameraMake ?? null),
    factExif('Camera model', oc?.cameraModel ?? r.provenance.deviceModel),
    factExif('Lens', oc?.lens ?? null),
    factExif('Focal length', oc?.focalLength ?? null),
    factExif('Exposure time', oc?.exposureTime ?? null),
    factExif('Aperture', oc?.aperture ?? null),
    factExif('ISO', oc?.iso ?? null),
    factExif('Flash', oc?.flash ?? null),
    factExif('Orientation', oc?.orientation ?? null),
    factExif('Software / editing app', oc?.software ?? null),
    fact('Original file type', r.identity.mimeType, 'recorded'),
    fact(
      'Original dimensions',
      oc?.width && oc?.height
        ? `${oc.width} × ${oc.height}`
        : r.provenance.imageWidth && r.provenance.imageHeight
          ? `${r.provenance.imageWidth} × ${r.provenance.imageHeight}`
          : (img?.widthPx && img?.heightPx ? `${img.widthPx} × ${img.heightPx}` : null),
      oc?.width ? 'recorded' : 'derived',
    ),
    fact('File size', fmtBytes(r.identity.fileSize), 'recorded'),
  ];

  const protectGps = prot?.locationLabel
    || (prot?.locationGps ? `${prot.locationGps.lat.toFixed(5)}, ${prot.locationGps.lng.toFixed(5)}` : null);
  const lastAccessLabel = lastAccess
    ? [lastAccess.city, lastAccess.country].filter(Boolean).join(', ')
      || (lastAccess.gpsLat != null && lastAccess.gpsLng != null
        ? `${lastAccess.gpsLat.toFixed(5)}, ${lastAccess.gpsLng.toFixed(5)}`
        : null)
    : null;
  const environment: IntelFact[] = [
    factExif('Capture GPS', captureGps),
    factExif('GPS altitude', oc?.gpsAltitude != null ? `${Math.round(oc.gpsAltitude)} m` : null),
    factExif('Orientation', oc?.orientation ?? null),
    factExif('Flash', oc?.flash ?? null),
    factExif('White balance', oc?.whiteBalance ?? null),
    factExif('Metering', oc?.meteringMode ?? null),
    factExif('Exposure program', oc?.exposureProgram ?? null),
    factExif('Light source', oc?.lightSource ?? null),
    factExif('Color space', oc?.colorSpace ?? null),
    factExif('Scene type', oc?.sceneCaptureType ?? null),
  ];

  const protection: IntelFact[] = [
    fact('DNA status', r.integrity.dnaStatus, 'verified'),
    fact('Protected by', prot?.protectedBy || ownerName, 'recorded'),
    fact('PINIT ID', prot?.pinitId || ownerShortId, 'recorded', (prot?.pinitId || ownerShortId) ?? undefined),
    fact('Protected on', fmtWhen(prot?.protectedAt || r.provenance.vaultedAt), 'recorded'),
    fact('Protection location', protectGps, 'recorded'),
    fact('Protection method', prot?.method || r.provenance.captureMethod || source || 'PinIT Vault encryption', 'recorded'),
    fact('Vault ID', r.vaultId, 'recorded', r.vaultId),
    fact('Encryption', prot?.encryption || r.identity.encryptionAlgorithm || 'AES-256-GCM', 'recorded'),
    fact('Watermark / signature', prot?.watermarkPresent ? 'Present' : null, prot?.watermarkPresent ? 'derived' : 'unavailable'),
    fact('Original metadata preserved', prot?.metadataPreserved ? 'Yes' : 'No camera EXIF in the stored file', prot?.metadataPreserved ? 'recorded' : 'unavailable'),
    fact('Last accessed', lastAccess
      ? `${lastAccess.action.replace(/_/g, ' ')} · ${fmtWhen(lastAccess.at)}${lastAccessLabel ? ` · ${lastAccessLabel}` : ''}`
      : null, lastAccess ? 'recorded' : 'unavailable'),
    fact('Tamper status', tamperLabel, rawTamper === 'VERIFIED' || rawTamper === 'TAMPERED' ? 'verified' : 'unavailable'),
    fact('Authenticity', authenticityLabel, verdictPending ? 'unavailable' : 'ai'),
    fact('Embedded identity', layersFlag.steganography ? 'Steganography layer present' : null, 'derived'),
    fact('AI manipulation check', aiLabel, verdictPending ? 'unavailable' : 'ai'),
    fact('Last verification', r.integrity.lastVerification ? `${r.integrity.lastVerification.passed ? 'Passed' : 'Failed'} · ${fmtWhen(r.integrity.lastVerification.at)}` : null, 'verified'),
  ];

  const journey: IntelEvent[] = [];
  journey.push({
    at: r.provenance.uploadedAt,
    title: 'Captured / received',
    detail: oc?.capturedAt
      ? `Original file capture time ${fmtWhen(oc.capturedAt)} (EXIF)`
      : 'No DateTimeOriginal in the original file metadata',
    category: 'CAPTURED',
  });
  journey.push({
    at: r.provenance.vaultedAt,
    title: 'Protected',
    detail: 'Stored in PinIT Vault',
    category: 'PROTECTED',
  });
  for (const c of tracking?.chainOfCustody ?? []) {
    const label = (c.step || c.eventType || 'Event').replace(/_/g, ' ');
    if (/protect|captur|vault/i.test(label) && journey.length <= 2) continue;
    journey.push({
      at: c.timestamp,
      title: label,
      detail: c.summary,
      category: /share/i.test(label) ? 'SHARED' : /verif/i.test(label) ? 'VERIFIED' : /edit/i.test(label) ? 'EDITED' : 'ACTIVITY',
    });
  }
  for (const ev of r.distribution.timeline) {
    journey.push({
      at: ev.at,
      title: ev.action.replace(/_/g, ' '),
      detail: [ev.device, ev.country, ev.browser].filter(Boolean).join(' · ') || 'Share / access event',
      category: /download/i.test(ev.action) ? 'DOWNLOADED' : 'SHARED',
    });
  }
  for (const ev of input.activityEvents) {
    if (!/INVESTIGATION|TAMPER|FOUND_ONLINE|EVIDENCE|VERIF/i.test(ev.type)) continue;
    journey.push({ at: ev.at, title: ev.title, detail: ev.detail, category: ev.type });
  }
  journey.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const investigations: IntelEvent[] = [
    ...input.activityEvents
      .filter((ev) => /INVESTIGATION|EVIDENCE|TAMPER|COMPARED/i.test(ev.type))
      .map((ev) => ({ at: ev.at, title: ev.title, detail: ev.detail, category: ev.type })),
    ...r.risk.recentEvidence.map((e) => ({
      at: e.at,
      title: e.type.replace(/_/g, ' '),
      detail: `${e.code} · ${e.description}`,
      category: 'EVIDENCE',
    })),
  ];
  if (investigations.length === 0 && input.investigationCount > 0) {
    investigations.push({
      at: r.generatedAt,
      title: 'Investigations on record',
      detail: `${input.investigationCount} investigation(s) counted for this asset`,
      category: 'INVESTIGATION',
    });
  }

  const layers: IntelLayer[] = [
    { key: 'crypto', name: 'Cryptographic', present: Boolean(layersFlag.crypto), note: r.integrity.sha256Hash ? 'SHA-256 stored' : 'Presence from DNA record' },
    { key: 'structural', name: 'Structural', present: Boolean(layersFlag.structural), note: 'Edge / structure fingerprint' },
    { key: 'perceptual', name: 'Perceptual', present: Boolean(layersFlag.perceptual), note: r.integrity.normalizedHash ? 'Perceptual hash stored' : 'Presence from DNA record' },
    { key: 'semantic', name: 'Color / semantic', present: Boolean(layersFlag.semantic), note: 'Color fingerprint when generated' },
    { key: 'metadata', name: 'Metadata', present: Boolean(layersFlag.metadata), note: 'EXIF / device fields when present in the file' },
    { key: 'steganography', name: 'Embedded identity', present: Boolean(layersFlag.steganography), note: 'Watermark / ownership layer when generated' },
    {
      key: 'prnu',
      name: 'Camera sensor (PRNU)',
      present: Boolean(r.cameraForensics),
      note: 'Supporting camera-source signal — not a DNA layer and not PINIT user identity',
    },
  ];

  const cameraDisclaimer =
    r.cameraForensics?.disclaimer
    || 'PRNU correlates a camera sensor. It does not identify a PINIT user or prove ownership by itself.';
  const cf = r.cameraForensics;
  let cameraConclusion =
    'No camera-sensor estimate is stored for this asset. Images protected after this update may include one when quality allows.';
  if (cf) {
    if (cf.qualityStatus === 'INSUFFICIENT') {
      cameraConclusion = 'Insufficient PRNU quality — treated as inconclusive, not as a different camera.';
    } else if (cf.correlation != null && cf.correlation >= 0.32) {
      cameraConclusion = `Camera relationship: consistent with enrolled profile ${cf.fingerprintId ?? 'CAM-'}. Asset identity and ownership still come from DNA and the existing protection record.`;
    } else if (cf.enrolledNewProfile) {
      cameraConclusion = `A new camera-sensor profile was enrolled (${cf.fingerprintId ?? 'CAM-'}). Same PRNU on a later, different photograph would not block Protect.`;
    } else {
      cameraConclusion = 'No strong same-camera correlation against enrolled profiles, or quality is inconclusive.';
    }
  }
  const candidateText = cf?.sameCameraCandidates?.length
    ? cf.sameCameraCandidates.map((c) => `${c.fingerprintId} (${c.correlation})`).join('; ')
    : null;
  const camera = {
    present: Boolean(cf),
    disclaimer: cameraDisclaimer,
    conclusion: cameraConclusion,
    facts: [
      fact('Camera fingerprint', cf?.fingerprintId, 'derived', cf?.fingerprintId ?? undefined),
      fact('PRNU correlation', cf?.correlation != null ? String(cf.correlation) : null, 'derived'),
      fact('Quality', cf ? `${cf.qualityStatus}${typeof cf.quality === 'number' ? ` · ${cf.quality}` : ''}` : null, 'derived'),
      fact('Same-camera candidates', candidateText, candidateText ? 'derived' : 'unavailable'),
      fact('New profile enrolled', cf ? (cf.enrolledNewProfile ? 'Yes' : 'No') : null, 'derived'),
    ],
  };

  const views = r.distribution.totalViews;
  const shares = r.distribution.totalShareLinks || input.shareLinks.length;
  const downloads = r.distribution.totalDownloads;
  const matches = r.discovery.totalMatches;
  const verifications = r.integrity.lastVerification ? 1 : 0;

  const who = ownerName?.trim() || ownerShortId || 'the owner';
  const deviceBit = oc?.cameraModel ? ` using ${oc.cameraMake ? `${oc.cameraMake} ` : ''}${oc.cameraModel}` : '';
  const captureBit = fmtWhen(captureTime)
    ? `originally captured on ${fmtWhen(captureTime)}${deviceBit}`
    : 'has no original capture timestamp in file metadata';
  const snapParts = [
    `PinIT knows this asset ${captureBit}, was protected by ${who} on ${fmtWhen(r.provenance.vaultedAt)}, and registered with DNA ${shortId(r.identity.dnaRecordId)}.`,
    `It currently has protection status ${r.integrity.dnaStatus} and tamper status “${tamperLabel}”.`,
    `It has been viewed ${views} time${views === 1 ? '' : 's'}, shared across ${shares} link${shares === 1 ? '' : 's'}, downloaded ${downloads} time${downloads === 1 ? '' : 's'}, and ${r.integrity.lastVerification ? 'has a verification on record' : 'has not been independently re-checked'}.`,
  ];
  const latestInv = [...investigations].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
  if (r.discovery.totalMatches > 0) {
    snapParts.push(`Monitoring found ${r.discovery.totalMatches} online match(es).`);
  }
  if (latestInv) {
    snapParts.push(`The latest recorded investigation or evidence item is “${latestInv.title}”.`);
  }
  if (cf?.fingerprintId) {
    snapParts.push(`Camera-sensor fingerprint ${cf.fingerprintId} is supporting evidence only and does not identify a PINIT user.`);
  }

  return {
    generatedAt: r.generatedAt,
    vaultId: r.vaultId,
    filename: r.identity.filename,
    mimeType: r.identity.mimeType,
    fileTypeLabel: getVaultFileTypeDisplay(r.identity.mimeType, r.identity.filename),
    ownerName,
    ownerShortId,
    assetId,
    dnaId: r.identity.dnaRecordId,
    originId,
    previewVaultId: r.vaultId,
    firstSeen: fmtWhen(r.provenance.vaultedAt) ?? 'Unavailable',
    lastActivity: fmtWhen(lastActivity),
    captureSource: source,
    dnaStatus: r.integrity.dnaStatus,
    tamperStatus: rawTamper,
    tamperLabel,
    authenticityLabel,
    aiLabel,
    identity,
    capture,
    content: {
      summary: analysis?.summary || null,
      verdict,
      reasons: (analysis?.reasons ?? []).filter(Boolean),
      composition: analysis?.composition ?? null,
      ocrWords: r.discovery.ocrWordCount,
      ocrLanguage: r.discovery.ocrLanguage,
      analyzed: Boolean(analysis && !verdictPending),
    },
    environment,
    protection,
    journey,
    exposure: {
      views,
      shares,
      downloads,
      verifications,
      matches,
      countries: r.distribution.uniqueCountries,
      devices: r.distribution.uniqueDevices,
      recipients: r.distribution.recipients,
      events: r.distribution.timeline.map((ev) => ({
        at: ev.at,
        title: ev.action.replace(/_/g, ' '),
        detail: [ev.device, ev.country, ev.browser].filter(Boolean).join(' · ') || 'Access event',
        category: ev.riskLevel || 'EVENT',
      })),
      matchesList: r.discovery.recentMatches,
    },
    investigations,
    layers,
    camera,
    snapshot: snapParts.join(' '),
    leakIndicators: r.risk.leakIndicators,
    evidence: r.risk.recentEvidence,
    report: r,
  };
}
