/**
 * Extended platform events — DNA verify, monitoring, investigation, automation, share extras.
 */

import { platformEvents } from './platform-event.engine';
import type { PlatformEventInput } from './types';

function emit(partial: PlatformEventInput): void {
  platformEvents.emit(partial);
}

// ─── DNA ─────────────────────────────────────────────────────────────────────

export function emitDnaVerifyResult(params: {
  ownerUserId: string;
  dnaRecordId: string;
  filename: string;
  passed: boolean;
  confidence?: number;
}): void {
  emit({
    name: params.passed ? 'dna.verify.success' : 'dna.verify.failed',
    category: 'vault',
    severity: params.passed ? 'success' : 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'dna_record',
    entityId: params.dnaRecordId,
    title: params.passed ? 'DNA verification passed' : 'DNA verification failed',
    body: params.passed
      ? `${params.filename} verified (${Math.round((params.confidence ?? 1) * 100)}% confidence)`
      : `${params.filename} did not match the stored fingerprint`,
    deepLink: `/dna/${params.dnaRecordId}`,
    notificationType: params.passed ? 'DNA_VERIFY_SUCCESS' : 'DNA_VERIFY_FAILED',
    fileName: params.filename,
    dnaRecordId: params.dnaRecordId,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `dna_verify:${params.dnaRecordId}:${params.passed}`,
  });
}

export function emitDnaMismatch(params: {
  ownerUserId: string;
  dnaRecordId: string;
  filename: string;
  score?: number;
}): void {
  emit({
    name: 'dna.mismatch',
    category: 'vault',
    severity: 'critical',
    ownerUserId: params.ownerUserId,
    entityType: 'dna_record',
    entityId: params.dnaRecordId,
    title: 'DNA mismatch detected',
    body: `${params.filename} — fingerprint mismatch${params.score != null ? ` (${Math.round(params.score * 100)}%)` : ''}`,
    deepLink: `/dna/${params.dnaRecordId}`,
    notificationType: 'DNA_MISMATCH',
    fileName: params.filename,
    dnaRecordId: params.dnaRecordId,
    skipTimeline: true,
    skipAudit: true,
  });
}

// ─── Certificates ────────────────────────────────────────────────────────────

export function emitCertificateVerified(params: {
  ownerUserId: string;
  certificateId: string;
  valid: boolean;
}): void {
  if (params.valid) return;
  emit({
    name: 'certificate.validation.failed',
    category: 'certificates',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'certificate',
    entityId: params.certificateId,
    title: 'Certificate validation failed',
    body: `Certificate ${params.certificateId} could not be verified`,
    deepLink: '/certificates',
    notificationType: 'CERT_VALIDATION_FAILED',
    certificateId: params.certificateId,
    skipTimeline: true,
    skipAudit: true,
  });
}

export function emitCertificateExpired(params: {
  ownerUserId: string;
  certificateId: string;
  dnaRecordId: string;
}): void {
  emit({
    name: 'certificate.expired',
    category: 'certificates',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'certificate',
    entityId: params.certificateId,
    title: 'Certificate expired',
    body: `Certificate ${params.certificateId} has expired`,
    deepLink: '/certificates',
    notificationType: 'CERT_EXPIRED',
    certificateId: params.certificateId,
    dnaRecordId: params.dnaRecordId,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `cert_expired:${params.certificateId}`,
  });
}

// ─── Share extras ────────────────────────────────────────────────────────────

export function emitShareAccessBlocked(params: {
  ownerUserId: string;
  shareLinkId: string;
  token: string;
  filename: string;
  notificationType: 'VPN_BLOCKED' | 'TOR_BLOCKED' | 'GEO_BLOCKED' | 'UNAUTHORIZED_ACCESS' | 'POLICY_BLOCKED';
  reason: string;
  ip?: string | null;
  country?: string | null;
}): void {
  emit({
    name: `share.access.${params.notificationType.toLowerCase()}`,
    category: 'security',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'share_link',
    entityId: params.shareLinkId,
    shareLinkId: params.shareLinkId,
    title: params.reason,
    body: `${params.filename} — ${params.reason}`,
    deepLink: '/access-intelligence',
    notificationType: params.notificationType,
    linkToken: params.token,
    fileName: params.filename,
    ip: params.ip ?? undefined,
    country: params.country ?? undefined,
    payload: { reason: params.reason },
  });
}

export function emitLinkExpired(params: {
  ownerUserId: string;
  shareLinkId: string;
  token: string;
  filename: string;
  warning?: boolean;
}): void {
  emit({
    name: params.warning ? 'share.link.expiry_warning' : 'share.link.expired',
    category: 'sharing',
    severity: params.warning ? 'warning' : 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'share_link',
    entityId: params.shareLinkId,
    shareLinkId: params.shareLinkId,
    title: params.warning ? 'Share link expiring soon' : 'Share link expired',
    body: `${params.filename} link ${params.warning ? 'expires within 24 hours' : 'has expired'}`,
    deepLink: '/access-intelligence',
    notificationType: params.warning ? 'LINK_EXPIRY_WARNING' : 'LINK_EXPIRED',
    linkToken: params.token,
    fileName: params.filename,
    dedupeKey: `${params.warning ? 'exp_warn' : 'expired'}:${params.shareLinkId}`,
  });
}

export function emitLinkOneTimeConsumed(params: {
  ownerUserId: string;
  shareLinkId: string;
  token: string;
  filename: string;
}): void {
  emit({
    name: 'share.link.one_time_consumed',
    category: 'sharing',
    severity: 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'share_link',
    entityId: params.shareLinkId,
    shareLinkId: params.shareLinkId,
    title: 'One-time link consumed',
    body: `${params.filename} one-time link was used and is now inactive`,
    deepLink: '/access-intelligence',
    notificationType: 'LINK_ONE_TIME_CONSUMED',
    linkToken: params.token,
    fileName: params.filename,
    dedupeKey: `one_time:${params.shareLinkId}`,
  });
}

export function emitMaxDownloadsReached(params: {
  ownerUserId: string;
  shareLinkId: string;
  token: string;
  filename: string;
}): void {
  emit({
    name: 'share.link.max_downloads',
    category: 'sharing',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'share_link',
    entityId: params.shareLinkId,
    shareLinkId: params.shareLinkId,
    title: 'Download limit reached',
    body: `${params.filename} — maximum downloads reached`,
    deepLink: '/access-intelligence',
    notificationType: 'MAX_DOWNLOADS_REACHED',
    linkToken: params.token,
    fileName: params.filename,
    dedupeKey: `max_dl:${params.shareLinkId}`,
  });
}

// ─── Monitoring ──────────────────────────────────────────────────────────────

export function emitMonitoringLifecycle(params: {
  ownerUserId: string;
  monitorRecordId: string;
  filename: string;
  action: 'started' | 'paused' | 'resumed' | 'stopped';
}): void {
  const typeMap = {
    started: 'MONITORING_STARTED',
    paused: 'MONITORING_PAUSED',
    resumed: 'MONITORING_RESUMED',
    stopped: 'MONITORING_STOPPED',
  } as const;
  emit({
    name: `monitoring.${params.action}`,
    category: 'monitoring',
    severity: 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'monitor_record',
    entityId: params.monitorRecordId,
    title: `Monitoring ${params.action}`,
    body: `${params.filename} monitoring ${params.action}`,
    deepLink: '/monitoring',
    notificationType: typeMap[params.action],
    fileName: params.filename,
    skipNotification: true,
    dedupeKey: `monitor_${params.action}:${params.monitorRecordId}`,
  });
}

export function emitCrawlerScanCompleted(params: {
  ownerUserId: string;
  monitorRecordId: string;
  filename: string;
  matchesFound: number;
  urlsChecked: number;
}): void {
  if (params.matchesFound > 0) return;
  emit({
    name: 'monitoring.scan.completed',
    category: 'monitoring',
    severity: 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'monitor_record',
    entityId: params.monitorRecordId,
    title: 'Crawler scan completed',
    body: `${params.filename} — ${params.urlsChecked} URLs checked, no matches`,
    deepLink: '/monitoring',
    notificationType: 'CRAWLER_SCAN_COMPLETED',
    fileName: params.filename,
    skipNotification: true,
    dedupeKey: `scan_done:${params.monitorRecordId}:${new Date().toISOString().slice(0, 10)}`,
  });
}

export function emitCrawlerError(params: {
  ownerUserId: string;
  monitorRecordId: string;
  filename: string;
  error: string;
}): void {
  emit({
    name: 'monitoring.scan.error',
    category: 'monitoring',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'monitor_record',
    entityId: params.monitorRecordId,
    title: 'Crawler scan error',
    body: `${params.filename} — ${params.error.slice(0, 120)}`,
    deepLink: '/monitoring',
    notificationType: 'CRAWLER_ERROR',
    fileName: params.filename,
    dedupeKey: `scan_err:${params.monitorRecordId}:${new Date().toISOString().slice(0, 13)}`,
  });
}

// ─── Investigation ───────────────────────────────────────────────────────────

export function emitInvestigationStarted(params: {
  ownerUserId: string;
  investigationId: string;
  filename: string;
}): void {
  emit({
    name: 'investigation.started',
    category: 'investigation',
    severity: 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'investigation',
    entityId: params.investigationId,
    investigationId: params.investigationId,
    title: 'Investigation started',
    body: `Analyzing ${params.filename}`,
    deepLink: '/pinit-hub/investigation',
    notificationType: 'INVESTIGATION_STARTED',
    fileName: params.filename,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `inv_start:${params.investigationId}`,
  });
}

export function emitInvestigationFailed(params: {
  ownerUserId: string;
  investigationId: string;
  filename: string;
  reason: string;
}): void {
  emit({
    name: 'investigation.failed',
    category: 'investigation',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'investigation',
    entityId: params.investigationId,
    investigationId: params.investigationId,
    title: 'Investigation failed',
    body: `${params.filename} — ${params.reason}`,
    deepLink: '/pinit-hub/investigation',
    notificationType: 'INVESTIGATION_FAILED',
    fileName: params.filename,
    skipTimeline: true,
    skipAudit: true,
  });
}

export function emitAiTamperingDetected(params: {
  ownerUserId: string;
  dnaRecordId?: string;
  investigationId?: string;
  filename: string;
  vector?: string;
}): void {
  emit({
    name: 'forensics.ai.tampering',
    category: 'security',
    severity: 'critical',
    ownerUserId: params.ownerUserId,
    entityType: 'investigation',
    entityId: params.investigationId ?? params.dnaRecordId ?? 'unknown',
    investigationId: params.investigationId,
    dnaRecordId: params.dnaRecordId,
    title: 'AI tampering detected',
    body: `${params.filename}${params.vector ? ` — ${params.vector}` : ''}`,
    deepLink: '/pinit-hub/investigation',
    notificationType: 'AI_TAMPERING_DETECTED',
    fileName: params.filename,
    skipTimeline: true,
    skipAudit: true,
  });
}

// ─── Automation (per-user) ───────────────────────────────────────────────────

export function emitAutomationCompleted(params: {
  ownerUserId: string;
  taskName: string;
  status: string;
  detail?: string;
}): void {
  emit({
    name: 'automation.completed',
    category: 'automation',
    severity: params.status === 'CRITICAL' ? 'critical' : 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'automation',
    entityId: `${params.taskName}:${new Date().toISOString().slice(0, 10)}`,
    title: `Automation: ${params.taskName}`,
    body: params.detail ?? params.status,
    deepLink: '/dashboard',
    notificationType: 'AUTOMATION_COMPLETED',
    skipTimeline: true,
    skipAudit: true,
    skipNotification: params.status === 'HEALTHY',
    dedupeKey: `auto:${params.taskName}:${params.ownerUserId}:${new Date().toISOString().slice(0, 10)}`,
  });
}

export function emitVaultIntegrityIssue(params: {
  ownerUserId: string;
  vaultId: string;
  filename: string;
  issue: 'missing' | 'mismatch';
}): void {
  emit({
    name: 'vault.integrity.issue',
    category: 'vault',
    severity: 'critical',
    ownerUserId: params.ownerUserId,
    entityType: 'vault',
    entityId: params.vaultId,
    vaultId: params.vaultId,
    title: 'Vault integrity issue',
    body: `${params.filename} — file ${params.issue === 'missing' ? 'missing from storage' : 'size mismatch'}`,
    deepLink: '/vault',
    notificationType: 'VAULT_ENCRYPTION_FAILED',
    fileName: params.filename,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `vault_integrity:${params.vaultId}`,
  });
}

export function emitTepCreated(params: {
  ownerUserId: string;
  vaultId: string;
  dnaRecordId: string;
  filename: string;
  tepCode: string;
}): void {
  emit({
    name: 'vault.tep.created',
    category: 'vault',
    severity: 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'tep',
    entityId: params.tepCode,
    title: 'TEP package created',
    body: `Tracked export ${params.tepCode} for ${params.filename}`,
    deepLink: '/vault',
    notificationType: 'TEP_CREATED',
    fileName: params.filename,
    vaultId: params.vaultId,
    dnaRecordId: params.dnaRecordId,
    skipNotification: true,
    dedupeKey: `tep_created:${params.tepCode}`,
  });
}
