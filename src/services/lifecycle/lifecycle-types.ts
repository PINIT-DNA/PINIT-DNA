/**
 * Pinit ecosystem lifecycle — canonical event vocabulary.
 *
 * One Pinit ecosystem -> one connected asset identity (Asset.id) -> many lifecycle
 * events. This layer is additive: it names events the platform ALREADY performs and
 * maps them onto one vocabulary. It never invents an event, and it is not a second
 * source of truth for anything — Asset, Vault, DNA, Certificate, Share, Monitoring,
 * Investigation and Exchange stay authoritative for their own data.
 *
 * Frame DNA is deliberately absent: per-frame forensic data is protection data (see
 * VideoFrameDna), not activity. Downloading a 4,919-frame video produces one
 * ASSET_DOWNLOADED event, never one event per frame.
 */

export const LIFECYCLE_STAGES = [
  'protect',
  'store',
  'share',
  'track',
  'monitor',
  'understand',
  'prove',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const LIFECYCLE_TYPES = [
  // Protected asset
  'ASSET_PROTECTED',
  'ASSET_VIEWED',
  'ASSET_ACCESSED',
  'ASSET_DOWNLOADED',
  'ASSET_SHARED',
  'ASSET_RENAMED',
  'ASSET_DELETED',
  // Certificate
  'CERTIFICATE_ISSUED',
  'CERTIFICATE_VERIFIED',
  'CERTIFICATE_REVOKED',
  'CERTIFICATE_EXPIRED',
  // Portfolio
  'PORTFOLIO_VIEWED',
  // Exchange
  'ASSET_LISTED',
  'ASSET_UNLISTED',
  'ASSET_PURCHASED',
  'LICENSE_CREATED',
  'PURCHASE_DOWNLOADED',
  // Share links
  'SHARE_LINK_CREATED',
  'SHARE_LINK_OPENED',
  'SHARE_LINK_DOWNLOADED',
  'SHARE_LINK_REVOKED',
  'SHARE_LINK_EXPIRED',
  // Evidence
  'EVIDENCE_GENERATED',
  'EVIDENCE_VIEWED',
  'EVIDENCE_DOWNLOADED',
  'EVIDENCE_SHARED',
  // Monitoring / intelligence
  'MONITORING_MATCH_FOUND',
  'SUSPICIOUS_USE_DETECTED',
  'INVESTIGATION_STARTED',
  'INVESTIGATION_COMPLETED',
] as const;
export type LifecycleType = (typeof LIFECYCLE_TYPES)[number];

const TYPE_SET = new Set<string>(LIFECYCLE_TYPES);
export function isLifecycleType(value: unknown): value is LifecycleType {
  return typeof value === 'string' && TYPE_SET.has(value);
}

/**
 * Types with no backend action behind them today. Declared so the contract is stable
 * and the gap is explicit; never emitted, so no event is ever fabricated.
 *
 *  - ASSET_ACCESSED: opening an asset page is not a distinct server action. Viewing
 *    its bytes is ASSET_VIEWED and taking them is ASSET_DOWNLOADED.
 *  - PURCHASE_DOWNLOADED: happens inside the Exchange download authorisation, which
 *    does not post it through the activity bridge yet. The read side still maps the
 *    DOWNLOADED timeline rows Exchange does send.
 */
export const LIFECYCLE_TYPES_NOT_EMITTED: readonly LifecycleType[] = [
  'ASSET_ACCESSED',
  'PURCHASE_DOWNLOADED',
];

export const LIFECYCLE_STAGE_OF: Record<LifecycleType, LifecycleStage> = {
  ASSET_PROTECTED: 'protect',
  CERTIFICATE_ISSUED: 'protect',
  CERTIFICATE_REVOKED: 'protect',
  CERTIFICATE_EXPIRED: 'protect',
  ASSET_VIEWED: 'store',
  ASSET_ACCESSED: 'store',
  ASSET_DOWNLOADED: 'store',
  ASSET_RENAMED: 'store',
  ASSET_DELETED: 'store',
  ASSET_SHARED: 'share',
  SHARE_LINK_CREATED: 'share',
  SHARE_LINK_REVOKED: 'share',
  SHARE_LINK_EXPIRED: 'share',
  ASSET_LISTED: 'share',
  ASSET_UNLISTED: 'share',
  ASSET_PURCHASED: 'share',
  LICENSE_CREATED: 'share',
  SHARE_LINK_OPENED: 'track',
  SHARE_LINK_DOWNLOADED: 'track',
  PURCHASE_DOWNLOADED: 'track',
  PORTFOLIO_VIEWED: 'track',
  CERTIFICATE_VERIFIED: 'track',
  MONITORING_MATCH_FOUND: 'monitor',
  SUSPICIOUS_USE_DETECTED: 'monitor',
  INVESTIGATION_STARTED: 'understand',
  INVESTIGATION_COMPLETED: 'understand',
  EVIDENCE_GENERATED: 'prove',
  EVIDENCE_VIEWED: 'prove',
  EVIDENCE_DOWNLOADED: 'prove',
  EVIDENCE_SHARED: 'prove',
};

/** Plain wording for people, not event names. */
export const LIFECYCLE_LABEL: Record<LifecycleType, string> = {
  ASSET_PROTECTED: 'Protected',
  ASSET_VIEWED: 'Viewed in your Vault',
  ASSET_ACCESSED: 'Accessed',
  ASSET_DOWNLOADED: 'Downloaded by you',
  ASSET_SHARED: 'Shared',
  ASSET_RENAMED: 'Renamed',
  ASSET_DELETED: 'Deleted from Vault',
  CERTIFICATE_ISSUED: 'Certificate issued',
  CERTIFICATE_VERIFIED: 'Certificate verified',
  CERTIFICATE_REVOKED: 'Certificate revoked',
  CERTIFICATE_EXPIRED: 'Certificate expired',
  PORTFOLIO_VIEWED: 'Portfolio viewed',
  ASSET_LISTED: 'Listed on Exchange',
  ASSET_UNLISTED: 'Removed from Exchange',
  ASSET_PURCHASED: 'Purchased',
  LICENSE_CREATED: 'Licence issued',
  PURCHASE_DOWNLOADED: 'Downloaded by buyer',
  SHARE_LINK_CREATED: 'Share link created',
  SHARE_LINK_OPENED: 'Share link opened',
  SHARE_LINK_DOWNLOADED: 'Downloaded from share link',
  SHARE_LINK_REVOKED: 'Share link revoked',
  SHARE_LINK_EXPIRED: 'Share link expired',
  EVIDENCE_GENERATED: 'Evidence created',
  EVIDENCE_VIEWED: 'Evidence viewed',
  EVIDENCE_DOWNLOADED: 'Evidence downloaded',
  EVIDENCE_SHARED: 'Evidence shared',
  MONITORING_MATCH_FOUND: 'Match found online',
  SUSPICIOUS_USE_DETECTED: 'Suspicious use detected',
  INVESTIGATION_STARTED: 'Investigation started',
  INVESTIGATION_COMPLETED: 'Investigation completed',
};

/**
 * Existing Unified Event Engine names -> lifecycle type.
 *
 * Every name here is already emitted by a real action; this map adds no emit of its
 * own. Names left out (dna.generated, monitoring.scan.completed, share security
 * signals, account and billing events) are not lifecycle events and are untouched.
 */
const PLATFORM_EVENT_LIFECYCLE: Readonly<Record<string, LifecycleType>> = {
  'vault.stored': 'ASSET_PROTECTED',
  'publish_guardian.protected': 'ASSET_PROTECTED',
  'vault.deleted': 'ASSET_DELETED',
  'vault.renamed': 'ASSET_RENAMED',
  'vault.previewed': 'ASSET_VIEWED',
  'vault.retrieved': 'ASSET_DOWNLOADED',
  // 'vault.protected_download.ready' is deliberately NOT mapped: it fires when the
  // tracked export package is built, and 'vault.protected_download.completed' fires
  // when the file is actually served. Mapping both would count one download twice.
  'vault.protected_download.completed': 'ASSET_DOWNLOADED',
  'share.link.created': 'SHARE_LINK_CREATED',
  'share.link.viewed': 'SHARE_LINK_OPENED',
  'share.link.downloaded': 'SHARE_LINK_DOWNLOADED',
  'share.link.revoked': 'SHARE_LINK_REVOKED',
  'share.link.expired': 'SHARE_LINK_EXPIRED',
  'certificate.issued': 'CERTIFICATE_ISSUED',
  'certificate.verified': 'CERTIFICATE_VERIFIED',
  'certificate.revoked': 'CERTIFICATE_REVOKED',
  'certificate.expired': 'CERTIFICATE_EXPIRED',
  'portfolio.viewed': 'PORTFOLIO_VIEWED',
  'monitoring.match.found': 'MONITORING_MATCH_FOUND',
  'forensics.ai.tampering': 'SUSPICIOUS_USE_DETECTED',
  'investigation.started': 'INVESTIGATION_STARTED',
  'investigation.completed': 'INVESTIGATION_COMPLETED',
  'evidence.generated': 'EVIDENCE_GENERATED',
  'evidence.viewed': 'EVIDENCE_VIEWED',
  'evidence.downloaded': 'EVIDENCE_DOWNLOADED',
  'evidence.shared': 'EVIDENCE_SHARED',
};

/**
 * Resolve the lifecycle type of a platform event.
 *
 * Two names depend on what actually happened rather than the name alone: a Publish
 * Guardian discovery is suspicious use only when the copy is tampered or high risk,
 * and a blocked duplicate upload is suspicious use only when a DIFFERENT account
 * tried to upload this owner's file.
 */
export function lifecycleTypeForPlatformEvent(event: {
  name: string;
  lifecycleType?: string | null;
  payload?: Record<string, unknown> | null;
}): LifecycleType | null {
  if (event.lifecycleType && isLifecycleType(event.lifecycleType)) return event.lifecycleType;

  if (event.name === 'publish_guardian.discovery') {
    const tampered = event.payload?.['tampered'] === true;
    const riskScore = Number(event.payload?.['riskScore'] ?? 0);
    return tampered || riskScore >= 80 ? 'SUSPICIOUS_USE_DETECTED' : 'MONITORING_MATCH_FOUND';
  }
  if (event.name === 'duplicate.upload.blocked') {
    return event.payload?.['crossUser'] === true ? 'SUSPICIOUS_USE_DETECTED' : null;
  }
  return PLATFORM_EVENT_LIFECYCLE[event.name] ?? null;
}

/**
 * Existing AssetTimelineEvent types -> lifecycle type, for the READ side only.
 *
 * The timeline keeps being written exactly as it is today (Hub protect events and
 * the Exchange activity bridge); the lifecycle API reads it instead of duplicating
 * rows into it. Types with no lifecycle meaning (NOTE, STATUS_CHANGE, ...) are left out.
 */
const TIMELINE_LIFECYCLE: Readonly<Record<string, LifecycleType>> = {
  PROTECTED: 'ASSET_PROTECTED',
  CERTIFICATE: 'CERTIFICATE_ISSUED',
  SHARED: 'SHARE_LINK_CREATED',
  SHARE_VIEWED: 'SHARE_LINK_OPENED',
  SHARE_DOWNLOADED: 'SHARE_LINK_DOWNLOADED',
  LISTED: 'ASSET_LISTED',
  UNLISTED: 'ASSET_UNLISTED',
  SOLD: 'ASSET_PURCHASED',
  LICENSE_CREATED: 'LICENSE_CREATED',
  DOWNLOADED: 'PURCHASE_DOWNLOADED',
  DISCOVERY: 'MONITORING_MATCH_FOUND',
  TAMPERING: 'SUSPICIOUS_USE_DETECTED',
  INVESTIGATION: 'INVESTIGATION_COMPLETED',
  EVIDENCE: 'EVIDENCE_GENERATED',
};

export function lifecycleTypeForTimelineEvent(eventType: string): LifecycleType | null {
  return TIMELINE_LIFECYCLE[eventType] ?? null;
}
