/**
 * Forensic Provenance / Evidence Timeline Engine
 *
 * Append-only lifecycle events for a PINIT asset.
 * DNA remains immutable — location, downloads, tamper, and investigations
 * are stored here only and read into investigation reports.
 *
 * Does NOT modify DNA generation, comparison, Acceptance, or Ranking.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { Prisma } from '@prisma/client';

export const PROVENANCE_EVENT_TYPES = [
  'DNA_GENERATED',
  'ENCRYPTED',
  'VAULT_STORED',
  'CERTIFICATE_ISSUED',
  'DOWNLOADED',
  'PROTECTED_EXPORT',
  'TEP_CREATED',
  'SHARED',
  'OPENED',
  'FORWARDED',
  'RECOVERED',
  'INVESTIGATED',
  'TAMPERED',
  'CRAWLER_DETECTION',
  'REVOKED',
] as const;

export type ProvenanceEventType = (typeof PROVENANCE_EVENT_TYPES)[number];

export interface ProvenanceLocation {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** ip | gps | none — never invent GPS */
  locationSource?: 'ip' | 'gps' | 'none' | null;
  ipAddress?: string | null;
}

export interface AppendProvenanceInput extends ProvenanceLocation {
  eventType: ProvenanceEventType | string;
  summary: string;
  dnaRecordId?: string | null;
  vaultId?: string | null;
  certificateId?: string | null;
  tepCode?: string | null;
  shareLinkId?: string | null;
  investigationId?: string | null;
  actorUserId?: string | null;
  actorLabel?: string | null;
  userAgent?: string | null;
  device?: string | null;
  payload?: Record<string, unknown>;
  /** Prevents duplicate appends for the same logical action */
  dedupeKey?: string | null;
  /** Optional fixed timestamp (backfill / historical) */
  createdAt?: Date;
}

export interface ProvenanceTimelineEvent {
  id: string;
  eventType: string;
  summary: string;
  timestamp: string;
  dnaRecordId?: string;
  vaultId?: string;
  certificateId?: string;
  tepCode?: string;
  actorLabel?: string;
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  locationSource?: string;
  locationLabel?: string;
  device?: string;
  payload?: Record<string, unknown>;
  source: 'provenance' | 'legacy';
}

export interface ProvenanceSummary {
  creationLocation?: string;
  creationTime?: string;
  lastDownload?: string;
  lastProtectedExport?: string;
  lastKnownDevice?: string;
  lastKnownLocation?: string;
  firstInvestigation?: string;
  latestInvestigation?: string;
  tamperCount: number;
  downloadCount: number;
  shareCount: number;
  investigationCount: number;
  countriesSeen: string[];
  devicesSeen: string[];
}

function locationLabel(ev: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): string | undefined {
  const parts = [ev.city, ev.region, ev.country].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function mapRow(row: {
  id: string;
  eventType: string;
  summary: string;
  createdAt: Date;
  dnaRecordId: string | null;
  vaultId: string | null;
  certificateId: string | null;
  tepCode: string | null;
  actorLabel: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: string | null;
  device: string | null;
  payload: unknown;
  source?: 'provenance' | 'legacy';
}): ProvenanceTimelineEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    summary: row.summary,
    timestamp: row.createdAt.toISOString(),
    dnaRecordId: row.dnaRecordId ?? undefined,
    vaultId: row.vaultId ?? undefined,
    certificateId: row.certificateId ?? undefined,
    tepCode: row.tepCode ?? undefined,
    actorLabel: row.actorLabel ?? undefined,
    country: row.country ?? undefined,
    region: row.region ?? undefined,
    city: row.city ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    locationSource: row.locationSource ?? undefined,
    locationLabel: locationLabel(row),
    device: row.device ?? undefined,
    payload: (row.payload && typeof row.payload === 'object')
      ? row.payload as Record<string, unknown>
      : undefined,
    source: row.source ?? 'provenance',
  };
}

class ForensicProvenanceService {
  /**
   * Append-only write. Never updates prior rows.
   * Failures are logged and swallowed so callers never break DNA/vault/TEP flows.
   */
  async append(input: AppendProvenanceInput): Promise<string | null> {
    try {
      if (input.dedupeKey) {
        const existing = await prisma.forensicProvenanceEvent.findUnique({
          where: { dedupeKey: input.dedupeKey },
          select: { id: true },
        });
        if (existing) return existing.id;
      }

      const row = await prisma.forensicProvenanceEvent.create({
        data: {
          eventType: input.eventType,
          summary: input.summary,
          dnaRecordId: input.dnaRecordId ?? null,
          vaultId: input.vaultId ?? null,
          certificateId: input.certificateId ?? null,
          tepCode: input.tepCode ?? null,
          shareLinkId: input.shareLinkId ?? null,
          investigationId: input.investigationId ?? null,
          actorUserId: input.actorUserId ?? null,
          actorLabel: input.actorLabel ?? null,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          country: input.country ?? null,
          region: input.region ?? null,
          city: input.city ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          locationSource: input.locationSource ?? (input.latitude != null ? 'gps' : input.country ? 'ip' : 'none'),
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          device: input.device ?? null,
          dedupeKey: input.dedupeKey ?? null,
          ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        },
      });
      return row.id;
    } catch (err) {
      // Unique dedupe race
      if (input.dedupeKey && String(err).includes('Unique constraint')) {
        return null;
      }
      logger.warn('[ForensicProvenance] append failed (non-fatal)', {
        eventType: input.eventType,
        error: String(err),
      });
      return null;
    }
  }

  /** Fire-and-forget append — never blocks the caller. */
  appendAsync(input: AppendProvenanceInput): void {
    void this.append(input);
  }

  /**
   * Load append-only events + synthesize legacy history from existing tables
   * so assets created before this feature still show a chain of custody.
   */
  async getTimeline(params: {
    dnaRecordId: string;
    vaultId?: string | null;
  }): Promise<ProvenanceTimelineEvent[]> {
    const { dnaRecordId, vaultId } = params;

    let stored: Awaited<ReturnType<typeof prisma.forensicProvenanceEvent.findMany>> = [];
    try {
      stored = await prisma.forensicProvenanceEvent.findMany({
        where: {
          OR: [
            { dnaRecordId },
            ...(vaultId ? [{ vaultId }] : []),
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
    } catch (err) {
      // Table may not be migrated yet — legacy synthesis still works.
      logger.warn('[ForensicProvenance] event table unavailable — using legacy sources only', {
        error: String(err),
      });
    }

    const [dna, vault, certs, teps, shares] = await Promise.all([
      prisma.dnaRecord.findUnique({
        where: { id: dnaRecordId },
        select: {
          id: true,
          createdAt: true,
          imageFilename: true,
          imageMimeType: true,
          imageSizeBytes: true,
          sha256Hash: true,
          schemaVersion: true,
          engineVersion: true,
          ownerUserId: true,
          ownerUser: { select: { shortId: true, fullName: true } },
          metadataLayer: {
            select: {
              deviceMake: true,
              deviceModel: true,
              software: true,
              gpsLatitude: true,
              gpsLongitude: true,
            },
          },
        },
      }),
      vaultId
        ? prisma.vaultRecord.findUnique({ where: { id: vaultId } })
        : prisma.vaultRecord.findFirst({ where: { dnaRecordId } }),
      prisma.certificate.findMany({
        where: { dnaRecordId },
        orderBy: { issuedAt: 'asc' },
      }),
      prisma.trackedExportPackage.findMany({
        where: { dnaRecordId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.shareLink.findMany({
        where: { dnaRecordId },
        orderBy: { createdAt: 'asc' },
        include: {
          accessLogs: { orderBy: { createdAt: 'asc' }, take: 50 },
        },
      }),
    ]);

    const events: ProvenanceTimelineEvent[] = stored.map((r) => mapRow(r));
    const seenKeys = new Set(stored.map((s) => s.dedupeKey).filter(Boolean) as string[]);

    const pushLegacy = (ev: ProvenanceTimelineEvent, dedupeKey: string) => {
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);
      events.push({ ...ev, id: `legacy:${dedupeKey}`, source: 'legacy' });
    };

    if (dna) {
      const meta = dna.metadataLayer;
      pushLegacy({
        id: `legacy:dna:${dna.id}`,
        eventType: 'DNA_GENERATED',
        summary: `DNA generated — ${dna.imageFilename}`,
        timestamp: dna.createdAt.toISOString(),
        dnaRecordId: dna.id,
        actorLabel: dna.ownerUser?.fullName ?? dna.ownerUser?.shortId,
        latitude: meta?.gpsLatitude ?? undefined,
        longitude: meta?.gpsLongitude ?? undefined,
        locationSource: meta?.gpsLatitude != null ? 'gps' : 'none',
        locationLabel: meta?.gpsLatitude != null
          ? `${meta.gpsLatitude.toFixed(4)}, ${meta.gpsLongitude?.toFixed(4)}`
          : undefined,
        device: [meta?.deviceMake, meta?.deviceModel].filter(Boolean).join(' ') || undefined,
        payload: {
          sha256: dna.sha256Hash,
          mimeType: dna.imageMimeType,
          sizeBytes: dna.imageSizeBytes,
          schemaVersion: dna.schemaVersion,
          engineVersion: dna.engineVersion,
        },
        source: 'legacy',
      }, `legacy:dna:${dna.id}`);
    }

    if (vault) {
      pushLegacy({
        id: `legacy:vault:${vault.id}`,
        eventType: 'VAULT_STORED',
        summary: `Stored in vault — ${vault.originalFileName}`,
        timestamp: vault.createdAt.toISOString(),
        dnaRecordId: vault.dnaRecordId,
        vaultId: vault.id,
        payload: {
          encryptionAlgorithm: vault.encryptionAlgorithm,
          originalSizeBytes: vault.originalSizeBytes,
        },
        source: 'legacy',
      }, `legacy:vault:${vault.id}`);
    }

    for (const cert of certs) {
      pushLegacy({
        id: `legacy:cert:${cert.id}`,
        eventType: 'CERTIFICATE_ISSUED',
        summary: `Certificate issued — ${cert.certificateId}`,
        timestamp: cert.issuedAt.toISOString(),
        dnaRecordId: cert.dnaRecordId,
        vaultId: cert.vaultId,
        certificateId: cert.certificateId,
        source: 'legacy',
      }, `legacy:cert:${cert.id}`);
      if (cert.revokedAt) {
        pushLegacy({
          id: `legacy:revoke:${cert.id}`,
          eventType: 'REVOKED',
          summary: `Certificate revoked — ${cert.certificateId}`,
          timestamp: cert.revokedAt.toISOString(),
          dnaRecordId: cert.dnaRecordId,
          vaultId: cert.vaultId,
          certificateId: cert.certificateId,
          payload: { reason: cert.revocationReason },
          source: 'legacy',
        }, `legacy:revoke:${cert.id}`);
      }
    }

    for (const tep of teps) {
      const isProtected = (tep.shareLinkId ?? '').startsWith('protected-download:');
      pushLegacy({
        id: `legacy:tep:${tep.id}`,
        eventType: isProtected ? 'PROTECTED_EXPORT' : 'TEP_CREATED',
        summary: isProtected
          ? `Protected download — TEP ${tep.tepCode}`
          : `Tracked export package — ${tep.tepCode}`,
        timestamp: tep.createdAt.toISOString(),
        dnaRecordId: tep.dnaRecordId,
        vaultId: tep.vaultId,
        tepCode: tep.tepCode,
        country: tep.geoCountry ?? undefined,
        city: tep.geoCity ?? undefined,
        locationSource: tep.geoCountry ? 'ip' : 'none',
        locationLabel: locationLabel({ city: tep.geoCity, country: tep.geoCountry }),
        device: tep.deviceContext ?? undefined,
        payload: {
          recipientId: tep.recipientId,
          recipientEmail: tep.recipientEmail,
          exportSha256: tep.exportSha256,
          status: tep.status,
        },
        source: 'legacy',
      }, `legacy:tep:${tep.id}`);
    }

    for (const share of shares) {
      pushLegacy({
        id: `legacy:share:${share.id}`,
        eventType: 'SHARED',
        summary: `Share link created — ${share.filename}`,
        timestamp: share.createdAt.toISOString(),
        dnaRecordId: share.dnaRecordId,
        vaultId: share.vaultId,
        payload: { shareLinkId: share.id },
        source: 'legacy',
      }, `legacy:share:${share.id}`);

      for (const log of share.accessLogs) {
        pushLegacy({
          id: `legacy:access:${log.id}`,
          eventType: log.action?.includes('DOWNLOAD') ? 'DOWNLOADED' : 'OPENED',
          summary: `${log.action} — ${log.recipientName ?? 'recipient'}`,
          timestamp: log.createdAt.toISOString(),
          dnaRecordId: share.dnaRecordId,
          vaultId: share.vaultId,
          actorLabel: log.recipientName ?? undefined,
          country: log.gpsState ? undefined : log.country ?? undefined,
          region: log.gpsState ?? log.region ?? undefined,
          city: log.gpsCity ?? log.city ?? undefined,
          latitude: log.gpsLat ?? log.lat ?? undefined,
          longitude: log.gpsLng ?? log.lng ?? undefined,
          locationSource: log.locationShared ? 'gps' : log.country ? 'ip' : 'none',
          locationLabel: locationLabel({
            city: log.gpsCity ?? log.city,
            region: log.gpsState ?? log.region,
            country: log.country,
          }),
          device: log.device ?? log.os ?? undefined,
          payload: { action: log.action, browser: log.browser },
          source: 'legacy',
        }, `legacy:access:${log.id}`);
      }
    }

    return events.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  buildSummary(events: ProvenanceTimelineEvent[]): ProvenanceSummary {
    const countries = new Set<string>();
    const devices = new Set<string>();
    let tamperCount = 0;
    let downloadCount = 0;
    let shareCount = 0;
    let investigationCount = 0;

    let creationLocation: string | undefined;
    let creationTime: string | undefined;
    let lastDownload: string | undefined;
    let lastProtectedExport: string | undefined;
    let lastKnownDevice: string | undefined;
    let lastKnownLocation: string | undefined;
    let firstInvestigation: string | undefined;
    let latestInvestigation: string | undefined;

    for (const ev of events) {
      if (ev.country) countries.add(ev.country);
      if (ev.device) {
        devices.add(ev.device);
        lastKnownDevice = ev.device;
      }
      if (ev.locationLabel) lastKnownLocation = ev.locationLabel;

      if (ev.eventType === 'DNA_GENERATED') {
        creationTime = ev.timestamp;
        creationLocation = ev.locationLabel;
      }
      if (ev.eventType === 'DOWNLOADED' || ev.eventType === 'PROTECTED_EXPORT') {
        downloadCount++;
        lastDownload = ev.timestamp;
      }
      if (ev.eventType === 'PROTECTED_EXPORT' || ev.eventType === 'TEP_CREATED') {
        lastProtectedExport = ev.timestamp;
      }
      if (ev.eventType === 'SHARED') shareCount++;
      if (ev.eventType === 'TAMPERED') tamperCount++;
      if (ev.eventType === 'INVESTIGATED') {
        investigationCount++;
        if (!firstInvestigation) firstInvestigation = ev.timestamp;
        latestInvestigation = ev.timestamp;
      }
    }

    return {
      creationLocation,
      creationTime,
      lastDownload,
      lastProtectedExport,
      lastKnownDevice,
      lastKnownLocation,
      firstInvestigation,
      latestInvestigation,
      tamperCount,
      downloadCount,
      shareCount,
      investigationCount,
      countriesSeen: [...countries],
      devicesSeen: [...devices],
    };
  }
}

export interface AssetLocationStatus {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  /** Where DNA was generated / vaulted (user GPS or IP) */
  creationLabel?: string;
  creationSource?: 'gps' | 'ip' | 'none';
  /** Where protected downloads / shares were recorded */
  sharedLabel?: string;
  sharedSource?: 'gps' | 'ip' | 'none';
  sharedAt?: string;
  /** Present = last known custody location */
  presentLabel?: string;
  presentSource?: 'gps' | 'ip' | 'none';
  presentAt?: string;
  /** @deprecated use presentLabel */
  lastKnownLabel?: string;
  lastKnownSource?: 'gps' | 'ip' | 'none';
  lastKnownAt?: string;
}

/**
 * Batch location status for vault list/detail — never invents GPS.
 * Reads EXIF metadata + provenance events only.
 */
export async function getLocationStatusForAssets(
  dnaRecordIds: string[],
): Promise<Map<string, AssetLocationStatus>> {
  const map = new Map<string, AssetLocationStatus>();
  if (!dnaRecordIds.length) return map;

  const unique = [...new Set(dnaRecordIds)];

  const metas = await prisma.metadataLayer.findMany({
    where: { dnaRecordId: { in: unique } },
    select: {
      dnaRecordId: true,
      gpsLatitude: true,
      gpsLongitude: true,
    },
  });
  const metaByDna = new Map(metas.map((m) => [m.dnaRecordId, m]));

  type LocEv = {
    dnaRecordId: string | null;
    eventType: string;
    createdAt: Date;
    country: string | null;
    region: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    locationSource: string | null;
  };

  let events: LocEv[] = [];
  try {
    events = await prisma.forensicProvenanceEvent.findMany({
      where: {
        dnaRecordId: { in: unique },
        OR: [
          { country: { not: null } },
          { city: { not: null } },
          { latitude: { not: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        dnaRecordId: true,
        eventType: true,
        createdAt: true,
        country: true,
        region: true,
        city: true,
        latitude: true,
        longitude: true,
        locationSource: true,
      },
    });
  } catch {
    /* table may not exist yet */
  }

  const formatEv = (ev: LocEv) => {
    if (ev.latitude != null && ev.longitude != null) {
      return {
        label: `${ev.latitude.toFixed(5)}, ${ev.longitude.toFixed(5)}`,
        source: (ev.locationSource as 'gps' | 'ip' | 'none') || 'gps',
        at: ev.createdAt.toISOString(),
      };
    }
    const label = locationLabel(ev);
    return {
      label,
      source: (ev.locationSource as 'gps' | 'ip' | 'none')
        || (ev.country ? 'ip' : 'none'),
      at: ev.createdAt.toISOString(),
    };
  };

  const CREATION_TYPES = new Set(['DNA_GENERATED', 'ENCRYPTED', 'VAULT_STORED', 'CERTIFICATE_ISSUED']);
  const SHARE_TYPES = new Set(['DOWNLOADED', 'PROTECTED_EXPORT', 'TEP_CREATED', 'SHARED', 'OPENED']);

  for (const dnaId of unique) {
    const meta = metaByDna.get(dnaId);
    const dnaEvents = events.filter((e) => e.dnaRecordId === dnaId);

    let creationLabel: string | undefined;
    let creationSource: 'gps' | 'ip' | 'none' = 'none';
    if (meta?.gpsLatitude != null && meta?.gpsLongitude != null) {
      creationLabel = `${meta.gpsLatitude.toFixed(5)}, ${meta.gpsLongitude.toFixed(5)}`;
      creationSource = 'gps';
    } else {
      const creationEv = [...dnaEvents]
        .reverse()
        .find((e) => CREATION_TYPES.has(e.eventType) && (e.latitude != null || e.country || e.city));
      if (creationEv) {
        const f = formatEv(creationEv);
        creationLabel = f.label;
        creationSource = f.source;
      }
    }

    const shareEv = dnaEvents.find((e) => SHARE_TYPES.has(e.eventType) && (e.latitude != null || e.country || e.city));
    let sharedLabel: string | undefined;
    let sharedSource: 'gps' | 'ip' | 'none' = 'none';
    let sharedAt: string | undefined;
    if (shareEv) {
      const f = formatEv(shareEv);
      sharedLabel = f.label;
      sharedSource = f.source;
      sharedAt = f.at;
    }

    const presentEv = dnaEvents[0];
    let presentLabel: string | undefined;
    let presentSource: 'gps' | 'ip' | 'none' = 'none';
    let presentAt: string | undefined;
    if (presentEv) {
      const f = formatEv(presentEv);
      presentLabel = f.label;
      presentSource = f.source;
      presentAt = f.at;
    } else if (creationLabel) {
      presentLabel = creationLabel;
      presentSource = creationSource;
    }

    const available = !!(creationLabel || sharedLabel || presentLabel);
    map.set(dnaId, {
      status: available ? 'AVAILABLE' : 'UNAVAILABLE',
      creationLabel,
      creationSource,
      sharedLabel,
      sharedSource,
      sharedAt,
      presentLabel,
      presentSource,
      presentAt,
      lastKnownLabel: presentLabel,
      lastKnownSource: presentSource,
      lastKnownAt: presentAt,
    });
  }

  return map;
}

export const forensicProvenanceService = new ForensicProvenanceService();
