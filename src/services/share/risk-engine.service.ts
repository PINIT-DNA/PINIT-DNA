/**
 * PINIT-DNA — Location Trust & Risk Engine
 *
 * Integrated into Smart Link access logging (not a separate module).
 * Collects existing GPS / IP / VPN / Tor / device / history signals,
 * calculates risk + location trust, explains why, notifies the owner.
 *
 * Does NOT auto-block VPN or Fake GPS. Owner policy (Block VPN / TOR toggles)
 * remains separate and optional.
 *
 * Risk score: 0–30 Trusted · 31–60 Medium · 61–80 High · 81–100 Critical
 * Location trust: HIGH / MEDIUM / LOW (inverse of risk pressure on location signals)
 */

import { logger } from '../../lib/logger';

export interface RiskInput {
  action: string;
  country?: string | null;
  city?: string | null;
  region?: string | null;
  device?: string | null;
  browser?: string | null;
  os?: string | null;
  ipAddress?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  gpsAccuracyM?: number | null;
  ipLat?: number | null;
  ipLng?: number | null;
  isVpn?: boolean;
  isTor?: boolean;
  isProxy?: boolean;
  isDatacenter?: boolean;
  asn?: string | null;
  org?: string | null;
  isp?: string | null;
  deviceFingerprint?: string | null;
  history: Array<{
    action: string;
    country: string | null;
    city?: string | null;
    region?: string | null;
    ipAddress: string | null;
    device: string | null;
    browser?: string | null;
    createdAt: Date;
    gpsLat?: number | null;
    gpsLng?: number | null;
    deviceFingerprint?: string | null;
  }>;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type LocationTrust = 'HIGH' | 'MEDIUM' | 'LOW';

export type LocationAlertCode =
  | 'VPN_DETECTED'
  | 'PROXY_DETECTED'
  | 'TOR_DETECTED'
  | 'HOSTING_PROVIDER'
  | 'GPS_IP_MISMATCH'
  | 'IMPOSSIBLE_TRAVEL'
  | 'COUNTRY_CHANGED'
  | 'NEW_DEVICE'
  | 'DEVICE_CHANGED'
  | 'BROWSER_CHANGED'
  | 'GPS_ACCURACY_LOW'
  | 'SUSPICIOUS_ACTIVITY';

export interface RiskResult {
  score: number;
  level: RiskLevel;
  /** 100 − score (clamped). High = more trusted location story. */
  trustScore: number;
  locationTrust: LocationTrust;
  factors: string[];
  alerts: LocationAlertCode[];
  suggestedActions: string[];
  /** Location-consistency pressure (GPS/IP/travel) — for UI badges */
  locationInconsistent: boolean;
}

const SUSPICIOUS_ACTIONS = new Set([
  'COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'PRINT_ATTEMPT', 'SCREEN_RECORDING_ATTEMPT',
]);

const GPS_IP_MISMATCH_KM = 150;
const IMPOSSIBLE_TRAVEL_KM = 800;
const IMPOSSIBLE_TRAVEL_MS = 30 * 60 * 1000;
const LOCAL_MOVE_KM = 5;

const HOSTING_ORG_RE =
  /amazon|aws|google\s*cloud|gcp|microsoft|azure|digital\s*ocean|oracle|linode|vultr|hetzner|ovh|cloudflare|alibaba/i;

function levelFor(score: number): RiskLevel {
  if (score >= 81) return 'CRITICAL';
  if (score >= 61) return 'HIGH';
  if (score >= 31) return 'MEDIUM';
  return 'LOW'; // Trusted band
}

function locationTrustFor(score: number, locationInconsistent: boolean): LocationTrust {
  if (locationInconsistent || score >= 61) return 'LOW';
  if (score >= 31) return 'MEDIUM';
  return 'HIGH';
}

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function suggestedActionsFor(level: RiskLevel, alerts: LocationAlertCode[]): string[] {
  const actions = ['Continue Monitoring'];
  if (level === 'HIGH' || level === 'CRITICAL') {
    actions.unshift('Review Access');
    actions.splice(1, 0, 'Revoke Viewer');
  } else if (alerts.includes('VPN_DETECTED') || alerts.includes('TOR_DETECTED')) {
    actions.unshift('Review Access');
  }
  return [...new Set(actions)];
}

/** Serialize for ShareAccessLog.riskFactors (JSON string). */
export function serializeRiskEvidence(result: RiskResult): string {
  return JSON.stringify({
    version: 2,
    trustScore: result.trustScore,
    locationTrust: result.locationTrust,
    alerts: result.alerts,
    reasons: result.factors,
    suggestedActions: result.suggestedActions,
    locationInconsistent: result.locationInconsistent,
  });
}

/** Parse legacy string[] or v2 evidence object from riskFactors column. */
export function parseRiskEvidence(raw: string | null | undefined): {
  reasons: string[];
  alerts: LocationAlertCode[];
  trustScore: number | null;
  locationTrust: LocationTrust | null;
  suggestedActions: string[];
  locationInconsistent: boolean;
} {
  const empty = {
    reasons: [] as string[],
    alerts: [] as LocationAlertCode[],
    trustScore: null as number | null,
    locationTrust: null as LocationTrust | null,
    suggestedActions: [] as string[],
    locationInconsistent: false,
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const reasons = parsed.filter((x): x is string => typeof x === 'string');
      const locationInconsistent = reasons.some(r =>
        /fake gps|location spoof|gps.*ip|impossible travel/i.test(r),
      );
      return { ...empty, reasons, locationInconsistent };
    }
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      const reasons = Array.isArray(o.reasons)
        ? o.reasons.filter((x): x is string => typeof x === 'string')
        : [];
      const alerts = Array.isArray(o.alerts)
        ? (o.alerts.filter((x): x is LocationAlertCode => typeof x === 'string') as LocationAlertCode[])
        : [];
      return {
        reasons,
        alerts,
        trustScore: typeof o.trustScore === 'number' ? o.trustScore : null,
        locationTrust:
          o.locationTrust === 'HIGH' || o.locationTrust === 'MEDIUM' || o.locationTrust === 'LOW'
            ? o.locationTrust
            : null,
        suggestedActions: Array.isArray(o.suggestedActions)
          ? o.suggestedActions.filter((x): x is string => typeof x === 'string')
          : [],
        locationInconsistent: Boolean(o.locationInconsistent) ||
          reasons.some(r => /gps.*ip|impossible travel|location/i.test(r)),
      };
    }
  } catch { /* ignore */ }
  return empty;
}

export class RiskEngineService {

  score(input: RiskInput): RiskResult {
    let score = 0;
    const factors: string[] = [];
    const alerts: LocationAlertCode[] = [];
    const { history } = input;
    let locationInconsistent = false;

    // ── Behavioral ───────────────────────────────────────────────────────
    if (SUSPICIOUS_ACTIONS.has(input.action)) {
      score += 25;
      factors.push(`Suspicious action: ${input.action.replace(/_/g, ' ').toLowerCase()}`);
      alerts.push('SUSPICIOUS_ACTIVITY');
    }
    const priorSuspicious = history.filter(h => SUSPICIOUS_ACTIONS.has(h.action)).length;
    if (priorSuspicious >= 5) {
      score += 30;
      factors.push(`Repeated suspicious activity (${priorSuspicious} prior attempts)`);
      alerts.push('SUSPICIOUS_ACTIVITY');
    } else if (priorSuspicious >= 2) {
      score += 15;
      factors.push(`Multiple suspicious attempts earlier (${priorSuspicious})`);
    }

    // ── Network anonymity / hosting ──────────────────────────────────────
    if (input.isTor) {
      score += 40;
      factors.push('TOR exit node detected');
      alerts.push('TOR_DETECTED');
    }
    if (input.isVpn) {
      score += 22;
      factors.push('VPN detected');
      alerts.push('VPN_DETECTED');
    }
    if (input.isProxy) {
      score += 15;
      factors.push('Proxy detected');
      alerts.push('PROXY_DETECTED');
    }
    const org = input.org ?? input.isp ?? '';
    if (input.isDatacenter || HOSTING_ORG_RE.test(org)) {
      score += 18;
      factors.push(`Hosting / cloud provider IP${org ? ` (${org})` : ''}`);
      alerts.push('HOSTING_PROVIDER');
    }

    // ── Country / device / browser change ────────────────────────────────
    const knownCountries = new Set(history.map(h => h.country).filter(Boolean) as string[]);
    if (input.country && knownCountries.size > 0 && !knownCountries.has(input.country)) {
      score += 20;
      factors.push(`New country on this link: ${input.country}`);
      alerts.push('COUNTRY_CHANGED');
    }
    if (knownCountries.size >= 3) {
      score += 8;
      factors.push(`Accessed from ${knownCountries.size}+ countries`);
    }

    const fp = input.deviceFingerprint?.trim() || null;
    const knownFps = new Set(
      history.map(h => h.deviceFingerprint).filter(Boolean) as string[],
    );
    if (fp && knownFps.size > 0 && !knownFps.has(fp)) {
      score += 15;
      factors.push('New / changed device fingerprint');
      alerts.push('NEW_DEVICE');
      alerts.push('DEVICE_CHANGED');
    } else if (!fp && history.some(h => h.deviceFingerprint)) {
      score += 5;
      factors.push('Device fingerprint missing on this access');
    }

    const knownBrowsers = new Set(history.map(h => h.browser).filter(Boolean) as string[]);
    if (input.browser && knownBrowsers.size > 0 && !knownBrowsers.has(input.browser)) {
      score += 8;
      factors.push(`Browser changed (${input.browser})`);
      alerts.push('BROWSER_CHANGED');
    }

    // New device + new country + VPN
    if (
      alerts.includes('NEW_DEVICE') &&
      alerts.includes('COUNTRY_CHANGED') &&
      input.isVpn
    ) {
      score += 15;
      factors.push('New device + new country + VPN — elevated location risk');
    }

    // ── Velocity / bot ───────────────────────────────────────────────────
    if (history.length > 0) {
      const last = history[0]!;
      const deltaMs = Date.now() - new Date(last.createdAt).getTime();
      if (deltaMs < 2_000 && (input.action === 'VIEWED' || input.action === 'DOWNLOADED')) {
        score += 12;
        factors.push('Two access events within 2 seconds — possible automation');
      }
    }
    const recentWindow = history.filter(
      h => Date.now() - new Date(h.createdAt).getTime() < 60_000,
    ).length;
    if (recentWindow >= 8) {
      score += 12;
      factors.push(`High event velocity — ${recentWindow} events in 60s`);
    }

    // ── Location consistency (never trust GPS alone) ─────────────────────
    const hasGps =
      input.gpsLat != null && input.gpsLng != null &&
      Number.isFinite(input.gpsLat) && Number.isFinite(input.gpsLng);
    const hasIpGeo =
      input.ipLat != null && input.ipLng != null &&
      Number.isFinite(input.ipLat) && Number.isFinite(input.ipLng);

    if (hasGps && input.gpsAccuracyM != null && input.gpsAccuracyM > 2000) {
      score += 8;
      factors.push(`GPS accuracy low (±${Math.round(input.gpsAccuracyM)}m)`);
      alerts.push('GPS_ACCURACY_LOW');
    }

    if (hasGps && hasIpGeo) {
      const distKm = haversineKm(
        input.gpsLat!, input.gpsLng!,
        input.ipLat!, input.ipLng!,
      );
      if (distKm >= GPS_IP_MISMATCH_KM) {
        locationInconsistent = true;
        score += 35;
        factors.push(
          `GPS and IP mismatch — ~${Math.round(distKm)} km apart (GPS vs network location)`,
        );
        alerts.push('GPS_IP_MISMATCH');
      } else if (distKm <= LOCAL_MOVE_KM) {
        factors.push(`GPS and IP consistent (~${Math.round(distKm)} km)`);
      }
    }

    if (hasGps && input.isVpn && (input.gpsAccuracyM == null || input.gpsAccuracyM <= 100)) {
      locationInconsistent = true;
      score += 12;
      factors.push('Precise GPS reported while on VPN — verify location trust');
    }

    if (hasGps) {
      const priorWithGps = history.find(
        h => h.gpsLat != null && h.gpsLng != null &&
          Number.isFinite(h.gpsLat) && Number.isFinite(h.gpsLng),
      );
      if (priorWithGps?.gpsLat != null && priorWithGps.gpsLng != null) {
        const travelKm = haversineKm(
          priorWithGps.gpsLat, priorWithGps.gpsLng,
          input.gpsLat!, input.gpsLng!,
        );
        const deltaMs = Date.now() - new Date(priorWithGps.createdAt).getTime();
        if (travelKm <= LOCAL_MOVE_KM) {
          // same device local move — keep LOW pressure
        } else if (travelKm >= IMPOSSIBLE_TRAVEL_KM && deltaMs > 0 && deltaMs < IMPOSSIBLE_TRAVEL_MS) {
          locationInconsistent = true;
          const mins = Math.max(1, Math.round(deltaMs / 60_000));
          score += 40;
          factors.push(
            `Impossible travel — ~${Math.round(travelKm)} km in ${mins} min`,
          );
          alerts.push('IMPOSSIBLE_TRAVEL');
        }
      }
    }

    score = Math.min(100, Math.max(0, score));
    const level = levelFor(score);
    const trustScore = Math.max(0, Math.min(100, 100 - score));
    const locationTrust = locationTrustFor(score, locationInconsistent);
    const uniqueAlerts = [...new Set(alerts)];

    if (factors.length === 0) {
      factors.push('No anomalies — access pattern looks normal');
    }

    const result: RiskResult = {
      score,
      level,
      trustScore,
      locationTrust,
      factors,
      alerts: uniqueAlerts,
      suggestedActions: suggestedActionsFor(level, uniqueAlerts),
      locationInconsistent,
    };

    logger.debug('[LocationTrust] Scored access', {
      action: input.action, score, level, trustScore, locationTrust, alerts: uniqueAlerts,
    });

    return result;
  }
}

export const riskEngineService = new RiskEngineService();

/** @deprecated use locationInconsistent — kept for callers during transition */
export type LegacyRiskResult = RiskResult & { locationSpoofSuspected: boolean };
