/**
 * Module → platform event mappings (Phase 2).
 */

import { platformEvents } from './platform-event.engine';
import type { PlatformEventInput } from './types';

export function emitVaultStored(params: {
  ownerUserId: string;
  vaultId: string;
  dnaRecordId: string;
  filename: string;
}): void {
  platformEvents.emit({
    name: 'vault.stored',
    category: 'vault',
    severity: 'success',
    ownerUserId: params.ownerUserId,
    entityType: 'vault',
    entityId: params.vaultId,
    title: 'File stored in vault',
    body: `${params.filename} encrypted and stored`,
    deepLink: '/vault',
    notificationType: 'VAULT_STORED',
    fileName: params.filename,
    dnaRecordId: params.dnaRecordId,
    vaultId: params.vaultId,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `vault_stored:${params.vaultId}`,
  });
}

export function emitDnaGenerated(params: {
  ownerUserId: string;
  dnaRecordId: string;
  filename: string;
  country?: string | null;
  ip?: string | null;
}): void {
  platformEvents.emit({
    name: 'dna.generated',
    category: 'vault',
    severity: 'success',
    ownerUserId: params.ownerUserId,
    entityType: 'dna_record',
    entityId: params.dnaRecordId,
    title: 'DNA generated',
    body: `Fingerprint created for ${params.filename}`,
    deepLink: `/dna/${params.dnaRecordId}`,
    notificationType: 'DNA_GENERATED',
    fileName: params.filename,
    dnaRecordId: params.dnaRecordId,
    country: params.country ?? undefined,
    ip: params.ip ?? undefined,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `dna_generated:${params.dnaRecordId}`,
  });
}

export function emitCertificateIssued(params: {
  ownerUserId: string;
  certificateId: string;
  dnaRecordId: string;
  vaultId?: string | null;
}): void {
  platformEvents.emit({
    name: 'certificate.issued',
    category: 'certificates',
    severity: 'success',
    ownerUserId: params.ownerUserId,
    entityType: 'certificate',
    entityId: params.certificateId,
    title: 'Certificate issued',
    body: `Certificate ${params.certificateId} is ready`,
    deepLink: '/certificates',
    notificationType: 'CERT_GENERATED',
    dnaRecordId: params.dnaRecordId,
    vaultId: params.vaultId ?? undefined,
    certificateId: params.certificateId,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `cert_issued:${params.certificateId}`,
  });
}

export function emitMonitoringMatch(params: {
  ownerUserId: string;
  monitorRecordId: string;
  dnaRecordId: string;
  filename: string;
  url: string;
  matchType: string;
  similarity: number;
}): void {
  platformEvents.emit({
    name: 'monitoring.match.found',
    category: 'monitoring',
    severity: params.matchType.includes('EXACT') ? 'critical' : 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'monitor_record',
    entityId: params.monitorRecordId,
    title: 'Monitoring match detected',
    body: `${params.filename} may appear on ${params.url} (${params.similarity}% similarity)`,
    deepLink: '/monitoring',
    notificationType: 'MONITORING_MATCH',
    fileName: params.filename,
    dnaRecordId: params.dnaRecordId,
    dedupeKey: `monitor:${params.monitorRecordId}:${params.url.slice(0, 120)}`,
    payload: { url: params.url, matchType: params.matchType, similarity: params.similarity },
  });
}

export function emitDuplicateUploadBlocked(params: {
  ownerUserId: string;
  dnaRecordId: string;
  filename: string;
  matchType: string;
  uploaderLabel?: string;
}): void {
  platformEvents.emit({
    name: 'duplicate.upload.blocked',
    category: 'security',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'dna_record',
    entityId: params.dnaRecordId,
    title: 'Duplicate upload blocked',
    body: `${params.uploaderLabel ?? 'Someone'} tried to upload a duplicate of ${params.filename}`,
    deepLink: '/duplicate-attempts',
    notificationType: 'DUPLICATE_UPLOAD_ATTEMPT',
    fileName: params.filename,
    dnaRecordId: params.dnaRecordId,
    skipAudit: true,
    dedupeKey: `dup_upload:${params.dnaRecordId}:${Date.now().toString(36)}`,
    payload: { matchType: params.matchType },
  });
}

export function emitVaultDeleted(params: {
  ownerUserId: string;
  vaultId: string;
  dnaRecordId: string;
  filename: string;
}): void {
  platformEvents.emit({
    name: 'vault.deleted',
    category: 'vault',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'vault',
    entityId: params.vaultId,
    title: 'File removed from vault',
    body: `${params.filename} was deleted from your vault`,
    deepLink: '/vault',
    notificationType: 'VAULT_DELETED',
    fileName: params.filename,
    dnaRecordId: params.dnaRecordId,
    vaultId: params.vaultId,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `vault_deleted:${params.vaultId}`,
  });
}

export function emitCertificateRevoked(params: {
  ownerUserId: string;
  certificateId: string;
  dnaRecordId: string;
  reason: string;
}): void {
  platformEvents.emit({
    name: 'certificate.revoked',
    category: 'certificates',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'certificate',
    entityId: params.certificateId,
    title: 'Certificate revoked',
    body: `${params.certificateId} — ${params.reason}`,
    deepLink: '/certificates',
    notificationType: 'CERT_REVOKED',
    certificateId: params.certificateId,
    dnaRecordId: params.dnaRecordId,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `cert_revoked:${params.certificateId}`,
  });
}

export function emitProtectedDownloadReady(params: {
  ownerUserId: string;
  vaultId: string;
  dnaRecordId: string;
  filename: string;
  tepCode: string;
}): void {
  platformEvents.emit({
    name: 'vault.protected_download.ready',
    category: 'vault',
    severity: 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'vault',
    entityId: params.vaultId,
    title: 'Protected download ready',
    body: `TEP package ${params.tepCode} created for ${params.filename}`,
    deepLink: `/vault`,
    notificationType: 'PROTECTED_DOWNLOAD_READY',
    fileName: params.filename,
    vaultId: params.vaultId,
    dnaRecordId: params.dnaRecordId,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `tep_created:${params.tepCode}`,
    payload: { tepCode: params.tepCode },
  });
}

export function emitTepRevoked(params: {
  ownerUserId: string;
  tepCode: string;
  vaultId?: string | null;
  dnaRecordId?: string | null;
  reason?: string;
}): void {
  platformEvents.emit({
    name: 'vault.tep.revoked',
    category: 'vault',
    severity: 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'tep',
    entityId: params.tepCode,
    title: 'Protected download revoked',
    body: `TEP ${params.tepCode} is no longer valid`,
    deepLink: '/vault',
    notificationType: 'TEP_REVOKED',
    vaultId: params.vaultId ?? undefined,
    dnaRecordId: params.dnaRecordId ?? undefined,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `tep_revoked:${params.tepCode}`,
    payload: { reason: params.reason },
  });
}

export function emitInvestigationCompleted(params: {
  ownerUserId: string;
  investigationId: string;
  dnaRecordId?: string | null;
  vaultId?: string | null;
  verdict: string;
  filename: string;
}): void {
  platformEvents.emit({
    name: 'investigation.completed',
    category: 'investigation',
    severity: 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'investigation',
    entityId: params.investigationId,
    title: 'Investigation complete',
    body: `${params.filename} — ${params.verdict}`,
    deepLink: '/investigation',
    notificationType: 'INVESTIGATION_COMPLETED',
    skipTimeline: true,
    skipAudit: true,
    dnaRecordId: params.dnaRecordId ?? undefined,
    vaultId: params.vaultId ?? undefined,
    investigationId: params.investigationId,
    dedupeKey: `investigated:${params.investigationId}`,
    payload: { verdict: params.verdict },
  });
}

export function emitShareLinkCreated(params: {
  ownerUserId: string;
  shareLinkId: string;
  token: string;
  filename: string;
  dnaRecordId: string;
  vaultId: string;
}): void {
  platformEvents.emit({
    name: 'share.link.created',
    category: 'sharing',
    severity: 'info',
    ownerUserId: params.ownerUserId,
    entityType: 'share_link',
    entityId: params.shareLinkId,
    title: 'Share link created',
    body: `Secure link created for ${params.filename}`,
    deepLink: '/access-intelligence',
    notificationType: 'LINK_CREATED',
    linkToken: params.token,
    fileName: params.filename,
    shareLinkId: params.shareLinkId,
    dnaRecordId: params.dnaRecordId,
    vaultId: params.vaultId,
    dedupeKey: `share_created:${params.shareLinkId}`,
  });
}

export function emitSharePolicyBlocked(params: {
  ownerUserId: string;
  shareLinkId: string;
  token: string;
  filename: string;
  reason: string;
  country?: string | null;
  ip?: string | null;
  device?: string | null;
}): void {
  const event: PlatformEventInput = {
    name: 'share.policy.blocked',
    category: 'security',
    severity: 'warning',
    ownerUserId: params.ownerUserId,
    entityType: 'share_link',
    entityId: params.shareLinkId,
    title: 'Access blocked by policy',
    body: `${params.filename} — ${params.reason}`,
    deepLink: '/access-intelligence',
    notificationType: 'POLICY_BLOCKED',
    linkToken: params.token,
    fileName: params.filename,
    shareLinkId: params.shareLinkId,
    country: params.country ?? undefined,
    ip: params.ip ?? undefined,
    device: params.device ?? undefined,
    payload: { reason: params.reason },
  };
  platformEvents.emit(event);
}
