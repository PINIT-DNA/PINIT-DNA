/**
 * Protected download custody events (append-only).
 * Never blocks download — callers must catch failures.
 */
import crypto from 'crypto';
import { forensicProvenanceService } from '../forensics/forensic-provenance.service';
import { provenanceEventBus } from './event-bus';
import { lookupGeoIp } from './geo-ip.service';

export interface RecordProtectedDownloadInput {
  dnaRecordId: string;
  vaultId: string;
  actorUserId: string;
  certificateId?: string | null;
  tepCode?: string | null;
  shareLinkId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  recipientLabel?: string | null;
  purpose?: string | null;
  expiryDays?: number | null;
  forensicPreserved?: boolean;
  fileSha256?: string | null;
  tepTrackingFailed?: boolean;
  tepFailReason?: string | null;
  /** Pre-resolved geo (optional — will lookup from IP if omitted) */
  country?: string | null;
  city?: string | null;
  region?: string | null;
}

export interface RecordProtectedDownloadResult {
  downloadEventId: string;
  provenanceId: string | null;
}

export async function recordProtectedDownload(
  input: RecordProtectedDownloadInput,
): Promise<RecordProtectedDownloadResult> {
  const downloadEventId = crypto.randomUUID();
  let country = input.country ?? null;
  let city = input.city ?? null;
  let region = input.region ?? null;
  let locationSource: 'ip' | 'none' = country ? 'ip' : 'none';

  if (!country && input.ipAddress) {
    const geo = await lookupGeoIp(input.ipAddress);
    country = geo.country ?? null;
    city = geo.city ?? null;
    region = geo.region ?? null;
    locationSource = geo.locationSource;
  }

  const provenanceId = await forensicProvenanceService.append({
    eventType: 'DOWNLOADED',
    summary: input.tepCode
      ? `Protected download — TEP ${input.tepCode}`
      : 'Protected download (TEP embed unavailable)',
    dnaRecordId: input.dnaRecordId,
    vaultId: input.vaultId,
    tepCode: input.tepCode ?? null,
    certificateId: input.certificateId ?? null,
    shareLinkId: input.shareLinkId ?? null,
    actorUserId: input.actorUserId,
    actorLabel: input.recipientLabel ?? `owner:${input.actorUserId}`,
    ipAddress: input.ipAddress ?? null,
    country,
    city,
    region,
    locationSource,
    userAgent: input.userAgent ?? null,
    device: input.userAgent ?? null,
    payload: {
      downloadEventId,
      status: input.tepCode ? 'TEP_TRACKED' : 'DOWNLOAD_RECORDED',
      tepTrackingFailed: input.tepTrackingFailed ?? false,
      tepFailReason: input.tepFailReason ?? null,
      purpose: input.purpose ?? null,
      expiryDays: input.expiryDays ?? null,
      forensicPreserved: input.forensicPreserved ?? null,
      fileSha256: input.fileSha256 ?? null,
      channel: 'PROTECTED_DOWNLOAD',
    },
    dedupeKey: `protected_download:${downloadEventId}`,
  });

  await provenanceEventBus.emit('download.recorded', {
    downloadEventId,
    provenanceId,
    vaultId: input.vaultId,
    dnaRecordId: input.dnaRecordId,
    tepCode: input.tepCode,
  });

  return { downloadEventId, provenanceId };
}
