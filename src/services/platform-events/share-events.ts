/**
 * Share module → platform event mappings (Phase 1).
 */

import { platformEvents } from './platform-event.engine';
import type { PlatformEventInput } from './types';

export interface ShareAccessEventContext {
  ownerUserId: string;
  shareLinkId: string;
  token: string;
  filename: string;
  dnaRecordId?: string;
  vaultId?: string;
  action: string;
  ip?: string | null;
  country?: string | null;
  device?: string | null;
  riskLevel?: string;
  hopNumber?: number;
}

function todayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emitShareAccessEvent(ctx: ShareAccessEventContext): void {
  const fileName = ctx.filename || 'File';
  const country = ctx.country ?? 'Unknown';
  const device = ctx.device ?? 'Unknown';
  const ip = ctx.ip ?? 'Unknown';
  const base = {
    ownerUserId: ctx.ownerUserId,
    entityType: 'share_link',
    entityId: ctx.shareLinkId,
    shareLinkId: ctx.shareLinkId,
    dnaRecordId: ctx.dnaRecordId,
    vaultId: ctx.vaultId,
    linkToken: ctx.token,
    fileName,
    ip,
    country,
    device,
    deepLink: '/access-intelligence',
    category: 'sharing' as const,
  };

  const events: PlatformEventInput[] = [];

  switch (ctx.action) {
    case 'VIEWED':
      events.push({
        ...base,
        name: 'share.link.viewed',
        severity: 'info',
        notificationType: 'LINK_VIEWED',
        title: 'Link viewed',
        body: `${fileName} was viewed from ${country} · ${device}`,
        dedupeKey: `share.view:${ctx.token}:${todayBucket()}`,
        aggregate: true,
        skipAudit: true,
      });
      break;
    case 'DOWNLOADED':
      events.push({
        ...base,
        name: 'share.link.downloaded',
        severity: 'info',
        notificationType: 'LINK_DOWNLOADED',
        title: 'File downloaded',
        body: `${fileName} was downloaded from ${country} · ${device}`,
        skipAudit: true,
      });
      break;
    case 'FORWARDING_DETECTED':
      events.push({
        ...base,
        name: 'share.link.forwarded',
        severity: 'warning',
        notificationType: 'FORWARD_DETECTED',
        title: `Link forwarded${ctx.hopNumber ? ` — hop ${ctx.hopNumber}` : ''}`,
        body: `${fileName} was forwarded (${country} · ${ip})`,
        skipAudit: true,
      });
      break;
    case 'COPY_ATTEMPT':
      events.push({
        ...base,
        name: 'share.security.copy_attempt',
        severity: 'warning',
        notificationType: 'COPY_ATTEMPT',
        category: 'security',
        title: 'Copy attempt detected',
        body: `Someone tried to copy ${fileName} (${country})`,
      });
      break;
    case 'SCREENSHOT_ATTEMPT':
      events.push({
        ...base,
        name: 'share.security.screenshot_attempt',
        severity: 'warning',
        notificationType: 'SCREENSHOT_ATTEMPT',
        category: 'security',
        title: 'Screenshot attempt detected',
        body: `Screenshot attempt on ${fileName} (${country})`,
      });
      break;
    case 'PRINT_ATTEMPT':
      events.push({
        ...base,
        name: 'share.security.print_attempt',
        severity: 'warning',
        notificationType: 'PRINT_ATTEMPT',
        category: 'security',
        title: 'Print attempt detected',
        body: `Print attempt on ${fileName} (${country})`,
      });
      break;
    default:
      return;
  }

  if (ctx.riskLevel === 'HIGH' || ctx.riskLevel === 'CRITICAL') {
    events.push({
      ...base,
      name: 'share.risk.elevated',
      severity: ctx.riskLevel === 'CRITICAL' ? 'critical' : 'medium',
      notificationType: 'RISK_ALERT',
      category: 'security',
      title: `${ctx.riskLevel} risk detected`,
      body: `Suspicious access to ${fileName} from ${ip} · ${country}`,
      riskLevel: ctx.riskLevel,
      aggregate: false,
      skipAudit: true,
    });
  }

  for (const e of events) {
    platformEvents.emit(e);
  }
}

export function emitShareLinkRevoked(ownerUserId: string, shareLinkId: string, token: string, filename: string, ctx?: { dnaRecordId?: string; vaultId?: string }): void {
  platformEvents.emit({
    name: 'share.link.revoked',
    category: 'sharing',
    severity: 'info',
    ownerUserId,
    entityType: 'share_link',
    entityId: shareLinkId,
    shareLinkId,
    dnaRecordId: ctx?.dnaRecordId,
    vaultId: ctx?.vaultId,
    title: 'Share link revoked',
    body: `${filename || 'File'} link is no longer active`,
    deepLink: '/access-intelligence',
    notificationType: 'LINK_REVOKED',
    linkToken: token,
    fileName: filename,
  });
}
