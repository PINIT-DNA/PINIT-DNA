import { prisma } from '../../lib/prisma';
import type { IpIntelligenceResult } from './ip-intelligence.service';

export interface ForwardSignals {
  intendedDeviceFp?: string | null;
  intendedIp?: string | null;
  currentDeviceFp?: string;
  currentIp?: string;
  currentCountry?: string;
  currentLat?: number;
  currentLng?: number;
  ipIntel?: IpIntelligenceResult;
  recentAccessCount?: number;
  distinctDeviceCount?: number;
  distinctCountryCount?: number;
}

export interface ForwardVerdict {
  score: number;
  confidence: number;
  status: 'CLEAN' | 'SUSPECTED' | 'CONFIRMED';
  action: 'ALLOW' | 'FLAG' | 'SUSPEND' | 'BLOCK';
  reasons: string[];
}

export function computeForwardRisk(signals: ForwardSignals): ForwardVerdict {
  let score = 0;
  const reasons: string[] = [];

  // Signal 1: Device fingerprint mismatch (+30)
  if (signals.intendedDeviceFp && signals.currentDeviceFp &&
      signals.intendedDeviceFp !== signals.currentDeviceFp) {
    score += 30;
    reasons.push('Device fingerprint mismatch');
  }

  // Signal 2: IP subnet mismatch (+20)
  if (signals.intendedIp && signals.currentIp) {
    const intendedSubnet = signals.intendedIp.split('.').slice(0, 3).join('.');
    const currentSubnet = signals.currentIp.split('.').slice(0, 3).join('.');
    if (intendedSubnet !== currentSubnet) {
      score += 20;
      reasons.push('IP subnet mismatch');
    }
  }

  // Signal 3: TOR exit node (+35)
  if (signals.ipIntel?.isTor) {
    score += 35;
    reasons.push('TOR exit node detected');
  }

  // Signal 4: VPN (+20)
  if (signals.ipIntel?.isVpn) {
    score += 20;
    reasons.push('VPN detected');
  }

  // Signal 5: Proxy (+15)
  if (signals.ipIntel?.isProxy && !signals.ipIntel?.isTor) {
    score += 15;
    reasons.push('Proxy detected');
  }

  // Signal 6: Datacenter IP (+10)
  if (signals.ipIntel?.isDatacenter) {
    score += 10;
    reasons.push('Datacenter IP');
  }

  // Signal 7: Multiple distinct devices (+25)
  if ((signals.distinctDeviceCount ?? 0) > 1) {
    score += 25;
    reasons.push(`Multiple devices accessing same link (${signals.distinctDeviceCount})`);
  }

  // Signal 8: Multiple distinct countries (+30)
  if ((signals.distinctCountryCount ?? 0) > 1) {
    score += 30;
    reasons.push(`Access from multiple countries (${signals.distinctCountryCount})`);
  }

  // Signal 9: Burst access — >10 in 5 min (+20)
  if ((signals.recentAccessCount ?? 0) > 10) {
    score += 20;
    reasons.push(`Burst access (${signals.recentAccessCount} requests in 5 min)`);
  }

  const capped = Math.min(score, 100);
  let status: ForwardVerdict['status'];
  let action: ForwardVerdict['action'];

  if (capped >= 70) {
    status = 'CONFIRMED';
    action = 'BLOCK';
  } else if (capped >= 40) {
    status = 'SUSPECTED';
    action = 'FLAG';
  } else {
    status = 'CLEAN';
    action = 'ALLOW';
  }

  return { score: capped, confidence: capped, status, action, reasons };
}

export async function detectForwardingForLink(
  shareLinkId: string,
  currentIp: string,
  currentDeviceFp: string | undefined,
  ipIntel: IpIntelligenceResult
): Promise<ForwardVerdict> {
  const link = await prisma.shareLink.findUnique({ where: { id: shareLinkId } });
  if (!link) return { score: 0, confidence: 0, status: 'CLEAN', action: 'ALLOW', reasons: [] };

  // Count distinct devices and countries for this link in last 24h
  const since = new Date(Date.now() - 86400000);
  const logs = await prisma.shareAccessLog.findMany({
    where: { shareLinkId, createdAt: { gte: since } },
    select: { deviceFingerprint: true, country: true, createdAt: true },
  });

  const distinctDevices = new Set(logs.map(l => l.deviceFingerprint).filter(Boolean)).size;
  const distinctCountries = new Set(logs.map(l => l.country).filter(Boolean)).size;

  // Burst: access in last 5 min
  const fiveMinAgo = new Date(Date.now() - 300000);
  const recentCount = logs.filter(l => l.createdAt >= fiveMinAgo).length;

  const verdict = computeForwardRisk({
    intendedDeviceFp: link.intendedDeviceFingerprint,
    intendedIp: link.intendedIpAddress,
    currentDeviceFp,
    currentIp,
    currentCountry: ipIntel.country,
    currentLat: ipIntel.lat,
    currentLng: ipIntel.lng,
    ipIntel,
    recentAccessCount: recentCount,
    distinctDeviceCount: distinctDevices,
    distinctCountryCount: distinctCountries,
  });

  // Update link's forward risk
  if (verdict.score > (link.forwardRiskScore ?? 0)) {
    await prisma.shareLink.update({
      where: { id: shareLinkId },
      data: {
        forwardRiskScore: verdict.score,
        forwardConfidence: verdict.confidence,
        forwardStatus: verdict.status,
        forwardingDetected: verdict.status !== 'CLEAN',
      },
    });
  }

  return verdict;
}
