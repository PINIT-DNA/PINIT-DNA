/**
 * Lifecycle emitters for actions that had no platform event yet.
 *
 * Everything already emitted by the Unified Event Engine (share links, certificates
 * issued/revoked, monitoring matches, investigations, vault stored/deleted) keeps its
 * existing emit untouched — the engine now stamps those rows with a lifecycle type
 * and the owning Asset.id. This file only adds the missing ones, and each emit sits
 * after the real action has already succeeded.
 *
 * These are activity records, not notifications: they never raise a notification,
 * never write forensic provenance and never write audit rows, so no existing inbox,
 * chain of custody or audit trail changes shape.
 */
import { platformEvents } from '../platform-events/platform-event.engine';
import type { PlatformEventInput } from '../platform-events/types';
import type { LifecycleType } from './lifecycle-types';

/** Same calendar day, UTC — used to keep repeated views from flooding the history. */
function dayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

type LifecycleEmitInput = Omit<PlatformEventInput, 'category' | 'severity'> & {
  category?: PlatformEventInput['category'];
  severity?: PlatformEventInput['severity'];
  lifecycleType: LifecycleType;
};

function emitLifecycle(input: LifecycleEmitInput): void {
  platformEvents.emit({
    category: 'vault',
    severity: 'info',
    skipNotification: true,
    skipTimeline: true,
    skipAudit: true,
    ...input,
  });
}

/** Owner looked at the file itself (Vault preview decrypts and serves the bytes). */
export function emitAssetViewed(params: {
  ownerUserId: string;
  vaultId: string;
  dnaRecordId?: string | null;
  filename: string;
}): void {
  emitLifecycle({
    name: 'vault.previewed',
    lifecycleType: 'ASSET_VIEWED',
    ownerUserId: params.ownerUserId,
    entityType: 'vault',
    entityId: params.vaultId,
    title: 'Viewed in Vault',
    body: params.filename,
    deepLink: '/vault',
    fileName: params.filename,
    vaultId: params.vaultId,
    dnaRecordId: params.dnaRecordId ?? undefined,
    // Thumbnails re-request previews constantly; one view per file per day is the
    // honest summary of "the owner looked at this", without a row per image tile.
    dedupeKey: `lifecycle:asset_viewed:${params.vaultId}:${dayBucket()}`,
    persistOnce: true,
  });
}

/** Owner took the original bytes out of the Vault. */
export function emitAssetDownloaded(params: {
  ownerUserId: string;
  vaultId: string;
  dnaRecordId?: string | null;
  filename: string;
  /** "retrieve" (plain download) or "protected" (tracked export package) */
  via: 'retrieve' | 'protected';
  tepCode?: string | null;
}): void {
  emitLifecycle({
    name: params.via === 'protected' ? 'vault.protected_download.completed' : 'vault.retrieved',
    lifecycleType: 'ASSET_DOWNLOADED',
    ownerUserId: params.ownerUserId,
    entityType: 'vault',
    entityId: params.vaultId,
    title: params.via === 'protected' ? 'Protected download' : 'Downloaded from Vault',
    body: params.filename,
    deepLink: '/vault',
    fileName: params.filename,
    vaultId: params.vaultId,
    dnaRecordId: params.dnaRecordId ?? undefined,
    payload: params.tepCode ? { tepCode: params.tepCode, via: params.via } : { via: params.via },
  });
}

export function emitAssetRenamed(params: {
  ownerUserId: string;
  vaultId: string;
  dnaRecordId?: string | null;
  filename: string;
  previousFilename: string;
}): void {
  emitLifecycle({
    name: 'vault.renamed',
    lifecycleType: 'ASSET_RENAMED',
    ownerUserId: params.ownerUserId,
    entityType: 'vault',
    entityId: params.vaultId,
    title: 'Renamed',
    body: `${params.previousFilename} is now ${params.filename}`,
    deepLink: '/vault',
    fileName: params.filename,
    vaultId: params.vaultId,
    dnaRecordId: params.dnaRecordId ?? undefined,
    payload: { previousFilename: params.previousFilename },
  });
}

/** A certificate was checked and found valid (public verification endpoint). */
export function emitCertificateVerifiedOk(params: {
  ownerUserId: string;
  certificateId: string;
  dnaRecordId?: string | null;
  vaultId?: string | null;
}): void {
  emitLifecycle({
    name: 'certificate.verified',
    category: 'certificates',
    lifecycleType: 'CERTIFICATE_VERIFIED',
    ownerUserId: params.ownerUserId,
    entityType: 'certificate',
    entityId: params.certificateId,
    title: 'Certificate verified',
    body: `${params.certificateId} was checked and is valid`,
    deepLink: '/certificates',
    certificateId: params.certificateId,
    dnaRecordId: params.dnaRecordId ?? undefined,
    vaultId: params.vaultId ?? undefined,
    // Verification is public and anonymous: who checked is never recorded, and a
    // page refresh must not look like a second check.
    dedupeKey: `lifecycle:cert_verified:${params.certificateId}:${dayBucket()}`,
    persistOnce: true,
  });
}

/** Someone opened the owner's published portfolio page. */
export function emitPortfolioViewed(params: {
  ownerUserId: string;
  portfolioId: string;
  slug: string;
}): void {
  emitLifecycle({
    name: 'portfolio.viewed',
    category: 'account',
    lifecycleType: 'PORTFOLIO_VIEWED',
    ownerUserId: params.ownerUserId,
    entityType: 'portfolio',
    entityId: params.portfolioId,
    title: 'Portfolio viewed',
    body: `Your public portfolio (${params.slug}) was opened`,
    deepLink: '/portfolio',
    // The public page carries no viewer identity, so the honest unit is one view
    // per day, not a counter that implies we know who came.
    dedupeKey: `lifecycle:portfolio_viewed:${params.portfolioId}:${dayBucket()}`,
    persistOnce: true,
    payload: { slug: params.slug },
  });
}

type EvidenceAction = 'generated' | 'viewed' | 'downloaded' | 'shared';

const EVIDENCE_LIFECYCLE: Record<EvidenceAction, LifecycleType> = {
  generated: 'EVIDENCE_GENERATED',
  viewed: 'EVIDENCE_VIEWED',
  downloaded: 'EVIDENCE_DOWNLOADED',
  shared: 'EVIDENCE_SHARED',
};

const EVIDENCE_TITLE: Record<EvidenceAction, string> = {
  generated: 'Evidence created',
  viewed: 'Evidence viewed',
  downloaded: 'Evidence downloaded',
  shared: 'Evidence shared',
};

/**
 * Evidence lifecycle. The forensic record (EvidenceRecord / ClientReport / the
 * investigation itself) remains the source of truth; this only notes that it
 * happened, and when.
 */
export function emitEvidenceLifecycle(params: {
  ownerUserId: string;
  action: EvidenceAction;
  evidenceId: string;
  description?: string | null;
  dnaRecordId?: string | null;
  vaultId?: string | null;
  investigationId?: string | null;
  assetId?: string | null;
  evidenceCode?: string | null;
  reportType?: string | null;
}): void {
  emitLifecycle({
    name: `evidence.${params.action}`,
    category: 'reports',
    lifecycleType: EVIDENCE_LIFECYCLE[params.action],
    ownerUserId: params.ownerUserId,
    entityType: 'evidence',
    entityId: params.evidenceId,
    title: EVIDENCE_TITLE[params.action],
    body: params.description || params.evidenceCode || params.evidenceId,
    deepLink: '/evidence',
    dnaRecordId: params.dnaRecordId ?? undefined,
    vaultId: params.vaultId ?? undefined,
    investigationId: params.investigationId ?? undefined,
    assetId: params.assetId ?? undefined,
    payload: {
      ...(params.evidenceCode ? { evidenceCode: params.evidenceCode } : {}),
      ...(params.reportType ? { reportType: params.reportType } : {}),
    },
  });
}
