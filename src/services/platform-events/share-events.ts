/**
 * Share module → platform event mappings (Phase 1).
 * Location Trust & Risk alerts reuse the existing notification system.
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
  riskScore?: number;
  riskFactors?: string[];
  locationSpoofSuspected?: boolean;
  trustScore?: number;
  locationTrust?: string;
  alerts?: string[];
  suggestedActions?: string[];
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
  const deepLink = `/access-intelligence/${encodeURIComponent(ctx.token)}`;
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
    deepLink,
    category: 'sharing' as const,
  };

  const events: PlatformEventInput[] = [];
  const alerts = new Set(ctx.alerts ?? []);
  const topReasons = (ctx.riskFactors ?? [])
    .filter(f => !/^No anomalies/i.test(f) && !/^GPS and IP consistent/i.test(f))
    .slice(0, 3)
    .join(' · ');

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
    case 'SCREEN_RECORDING_ATTEMPT':
      events.push({
        ...base,
        name: 'share.security.screen_recording_attempt',
        severity: 'warning',
        notificationType: 'SCREEN_RECORDING_ATTEMPT',
        category: 'security',
        title: 'Screen recording attempt detected',
        body: `Screen recording attempt on ${fileName} (${country})`,
      });
      break;
    case 'DOWNLOAD_STARTED':
      events.push({
        ...base,
        name: 'share.link.download_started',
        severity: 'info',
        notificationType: 'LINK_DOWNLOADED',
        title: 'Download started',
        body: `${fileName} download started from ${country} · ${device}`,
        skipAudit: true,
      });
      break;
    case 'SHARE_FURTHER':
      events.push({
        ...base,
        name: 'share.link.share_further',
        severity: 'warning',
        notificationType: 'FORWARD_DETECTED',
        title: 'Link reshared',
        body: `${fileName} was reshared (${country} · ${ip})`,
      });
      break;
    default:
      break;
  }

  // ── Location Trust / Risk alerts (existing notification rails) ─────────
  const pushRisk = (
    notificationType: string,
    title: string,
    body: string,
    severity: PlatformEventInput['severity'] = 'warning',
    dedupeSuffix?: string,
  ) => {
    events.push({
      ...base,
      name: `share.risk.${notificationType.toLowerCase()}`,
      severity,
      notificationType,
      category: 'security',
      title,
      body,
      deepLink,
      riskLevel: ctx.riskLevel,
      aggregate: false,
      skipAudit: true,
      dedupeKey: dedupeSuffix
        ? `share.trust:${ctx.token}:${dedupeSuffix}:${todayBucket()}`
        : undefined,
    });
  };

  if (alerts.has('VPN_DETECTED')) {
    pushRisk('VPN_DETECTED', 'VPN detected', `${fileName}: viewer used a VPN (${ip} · ${country})`, 'warning', 'vpn');
  }
  if (alerts.has('PROXY_DETECTED')) {
    pushRisk('PROXY_DETECTED', 'Proxy detected', `${fileName}: proxy IP detected (${ip})`, 'warning', 'proxy');
  }
  if (alerts.has('TOR_DETECTED')) {
    pushRisk('TOR_DETECTED', 'TOR detected', `${fileName}: TOR exit node — critical anonymity signal`, 'critical', 'tor');
  }
  if (alerts.has('IMPOSSIBLE_TRAVEL')) {
    pushRisk('IMPOSSIBLE_TRAVEL', 'Impossible travel', `${fileName}: ${topReasons || 'GPS jumped too far too fast'}`, 'critical', 'travel');
  }
  if (alerts.has('GPS_IP_MISMATCH')) {
    pushRisk('GPS_IP_MISMATCH', 'GPS / IP mismatch', `${fileName}: ${topReasons || 'Browser GPS disagrees with network location'}`, 'warning', 'mismatch');
  }
  if (alerts.has('NEW_DEVICE') || alerts.has('DEVICE_CHANGED')) {
    pushRisk('NEW_DEVICE', 'Suspicious / new device', `${fileName}: new or changed device fingerprint (${country})`, 'warning', 'device');
  }
  if (alerts.has('COUNTRY_CHANGED')) {
    pushRisk('COUNTRY_CHANGED', 'New country', `${fileName}: access from a new country — ${country}`, 'warning', 'country');
  }

  if (ctx.riskLevel === 'HIGH' || ctx.riskLevel === 'CRITICAL') {
    pushRisk(
      'RISK_ALERT',
      `${ctx.riskLevel} risk access`,
      `${fileName}: Risk ${ctx.riskScore ?? ctx.riskLevel}` +
        (ctx.trustScore != null ? ` · Trust ${ctx.trustScore}` : '') +
        (topReasons ? ` — ${topReasons}` : ` (${ip} · ${country})`),
      ctx.riskLevel === 'CRITICAL' ? 'critical' : 'medium',
      `risk-${ctx.riskLevel}`,
    );
  } else if (ctx.locationSpoofSuspected) {
    pushRisk(
      'LOCATION_SPOOF_SUSPECTED',
      'Location trust low',
      `${fileName}: ${topReasons || 'Location signals inconsistent'}`,
      'warning',
      'loc-trust',
    );
  }

  // Deduplicate by notificationType within this emit batch
  const seen = new Set<string>();
  for (const e of events) {
    const key = e.notificationType ?? e.name;
    if (seen.has(key) && e.notificationType !== 'LINK_VIEWED' && e.notificationType !== 'LINK_DOWNLOADED') {
      continue;
    }
    seen.add(key);
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
