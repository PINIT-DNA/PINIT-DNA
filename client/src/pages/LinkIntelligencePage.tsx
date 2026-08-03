import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Globe, Eye, Download, Copy, Ban,
  Users, Clock, Smartphone, Monitor, MapPin, AlertTriangle, ExternalLink, XCircle,
} from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { formatDistanceToNow, format } from 'date-fns';
import {
  FileTrackingMap,
  type AccessKind,
  ACCESS_KIND_LABELS,
} from '../components/maps/FileTrackingMap';
import { isValidMapCoordinate, sanitizeCoordinatePair, isPrivateIp } from '../lib/geo-coords';
import { locationLabel } from '../lib/precise-gps';

interface AccessLog {
  id: string;
  createdAt: string;
  action: string;
  ipAddress: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  riskLevel: string | null;
  riskScore: number | null;
  riskFactors?: string | null;
  sessionId: string | null;
  screenResolution: string | null;
  isp: string | null;
  region: string | null;
  timezone: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsCity: string | null;
  gpsVillage: string | null;
  gpsMandal: string | null;
  gpsDistrict: string | null;
  gpsState: string | null;
  gpsPincode: string | null;
  gpsFullAddress: string | null;
  gpsAccuracy: number | null;
  locationSource: string | null;
  lat: number | null;
  lng: number | null;
  sessionDurationSec: number | null;
  recipientName: string | null;
  deviceFingerprint: string | null;
  isVpn?: boolean;
  isTor?: boolean;
  isProxy?: boolean;
  isDatacenter?: boolean;
  asn?: string | null;
  org?: string | null;
  /** From aggregated hop tree */
  shareLinkId?: string;
  linkType?: string | null;
  linkDepth?: number | null;
  isReshareLink?: boolean;
  hopToken?: string | null;
}

  interface LinkInfo {
  id: string;
  token: string;
  vaultId?: string | null;
  filename: string;
  createdAt: string;
  expiresAt: string | null;
  maxViews: number | null;
  viewCount: number;
  downloadCount: number;
  isActive: boolean;
  allowDownload: boolean;
  hopLinkCount?: number;
  accessLogs: AccessLog[];
  blockedViewers?: BlockedViewer[];
}

interface BlockedViewer {
  id: string;
  deviceFingerprint: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  label: string | null;
  createdAt: string;
}

interface Viewer {
  id: string;
  ip: string;
  country: string;
  city: string | null;
  region: string | null;
  isp: string | null;
  timezone: string | null;
  gpsCity: string | null;
  gpsVillage: string | null;
  gpsMandal: string | null;
  gpsDistrict: string | null;
  gpsState: string | null;
  gpsPincode: string | null;
  gpsFullAddress: string | null;
  gpsAccuracy: number | null;
  locationSource: string | null;
  device: string;
  browser: string;
  os: string;
  riskLevel: string;
  firstSeen: string;
  totalActions: number;
  actions: AccessLog[];
  hopNumber: number;
  lat: number | null;
  lng: number | null;
  deviceFingerprint: string | null;
  sessionId: string | null;
  isBlocked: boolean;
  blockId: string | null;
  riskScore: number;
  trustScore: number;
  locationTrust: 'HIGH' | 'MEDIUM' | 'LOW';
  locationInconsistent: boolean;
  riskFactors: string[];
  alerts: string[];
  suggestedActions: string[];
  isVpn: boolean;
  isTor: boolean;
  isProxy: boolean;
  isDatacenter: boolean;
  recipientName: string | null;
  /** Best GPS/IP before latest (for maps compare) */
  priorLat: number | null;
  priorLng: number | null;
  /** Green = direct recipient, blue = direct share, red = reshared */
  accessKind: AccessKind;
}

function classifyAccessKind(
  log: AccessLog,
  seenDirectOnParent: boolean,
): AccessKind {
  const isReshare =
    log.isReshareLink === true
    || (log.linkType != null && log.linkType !== 'PARENT')
    || (typeof log.linkDepth === 'number' && log.linkDepth > 0)
    || log.action === 'FORWARDING_DETECTED';

  if (isReshare) return 'reshared';
  if (!seenDirectOnParent) return 'direct_recipient';
  return 'direct_share';
}

const ACCESS_KIND_BADGE: Record<AccessKind, string> = {
  direct_recipient: 'bg-emerald-500/25 text-emerald-300 border-emerald-400/40',
  direct_share: 'bg-blue-500/25 text-blue-300 border-blue-400/40',
  reshared: 'bg-red-500/25 text-red-300 border-red-400/40',
};

const ACCESS_KIND_ICON: Record<AccessKind, string> = {
  direct_recipient: 'bg-emerald-600 border-emerald-300 text-white shadow-sm shadow-emerald-500/40',
  direct_share: 'bg-blue-600 border-blue-300 text-white shadow-sm shadow-blue-500/40',
  reshared: 'bg-red-600 border-red-300 text-white shadow-sm shadow-red-500/40',
};

const ACCESS_KIND_CARD: Record<AccessKind, { selected: string; idle: string }> = {
  direct_recipient: {
    selected: 'bg-emerald-500/15 border-emerald-400 ring-2 ring-emerald-400/40 shadow-[0_0_0_1px_rgba(52,211,153,0.35)]',
    idle: 'bg-emerald-500/10 border-emerald-500/70 ring-1 ring-emerald-400/30 hover:border-emerald-400 hover:ring-emerald-400/50',
  },
  direct_share: {
    selected: 'bg-blue-500/15 border-blue-400 ring-2 ring-blue-400/40',
    idle: 'bg-blue-500/10 border-blue-500/50 ring-1 ring-blue-400/25 hover:border-blue-400',
  },
  reshared: {
    selected: 'bg-red-500/15 border-red-400 ring-2 ring-red-400/40',
    idle: 'bg-red-500/10 border-red-500/50 ring-1 ring-red-400/25 hover:border-red-400',
  },
};

function parseRiskEvidence(raw: string | null | undefined): {
  reasons: string[];
  alerts: string[];
  trustScore: number | null;
  locationTrust: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  suggestedActions: string[];
  locationInconsistent: boolean;
} {
  const empty = {
    reasons: [] as string[],
    alerts: [] as string[],
    trustScore: null as number | null,
    locationTrust: null as 'HIGH' | 'MEDIUM' | 'LOW' | null,
    suggestedActions: [] as string[],
    locationInconsistent: false,
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const reasons = parsed.filter((x): x is string => typeof x === 'string');
      return {
        ...empty,
        reasons,
        locationInconsistent: reasons.some(r => /fake gps|gps.*ip|impossible travel|location/i.test(r)),
      };
    }
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      const reasons = Array.isArray(o.reasons)
        ? o.reasons.filter((x): x is string => typeof x === 'string')
        : [];
      const alerts = Array.isArray(o.alerts) ? o.alerts.filter((x): x is string => typeof x === 'string') : [];
      const lt = o.locationTrust;
      return {
        reasons,
        alerts,
        trustScore: typeof o.trustScore === 'number' ? o.trustScore : null,
        locationTrust: lt === 'HIGH' || lt === 'MEDIUM' || lt === 'LOW' ? lt : null,
        suggestedActions: Array.isArray(o.suggestedActions)
          ? o.suggestedActions.filter((x): x is string => typeof x === 'string')
          : [],
        locationInconsistent: Boolean(o.locationInconsistent),
      };
    }
  } catch { /* ignore */ }
  return empty;
}

function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

function trustFromRiskScore(score: number): { trustScore: number; locationTrust: 'HIGH' | 'MEDIUM' | 'LOW' } {
  const trustScore = Math.max(0, Math.min(100, 100 - score));
  const locationTrust = score >= 61 ? 'LOW' : score >= 31 ? 'MEDIUM' : 'HIGH';
  return { trustScore, locationTrust };
}

function mergeLocationFromLog(v: Viewer, log: AccessLog) {
  const gps = sanitizeCoordinatePair(log.gpsLat, log.gpsLng);
  const ip = sanitizeCoordinatePair(log.lat, log.lng);

  if (gps) {
    const incomingAcc = log.gpsAccuracy ?? Number.POSITIVE_INFINITY;
    const currentAcc = v.gpsAccuracy ?? Number.POSITIVE_INFINITY;
    const shouldReplace =
      !isValidMapCoordinate(v.lat, v.lng) ||
      incomingAcc < currentAcc ||
      (v.locationSource === 'ip' && (log.locationSource === 'gps' || log.locationSource === 'network'));

    if (shouldReplace) {
      v.lat = gps.lat;
      v.lng = gps.lng;
      v.locationSource = log.locationSource ?? 'gps';
      v.gpsAccuracy = log.gpsAccuracy ?? v.gpsAccuracy;
      if (log.gpsVillage) v.gpsVillage = log.gpsVillage;
      if (log.gpsMandal) v.gpsMandal = log.gpsMandal;
      if (log.gpsDistrict) v.gpsDistrict = log.gpsDistrict;
      if (log.gpsState) v.gpsState = log.gpsState;
      if (log.gpsPincode) v.gpsPincode = log.gpsPincode;
      if (log.gpsFullAddress) v.gpsFullAddress = log.gpsFullAddress;
      if (log.gpsCity) v.gpsCity = log.gpsCity;
    }
  } else if (!isValidMapCoordinate(v.lat, v.lng) && ip) {
    v.lat = ip.lat;
    v.lng = ip.lng;
    v.locationSource = 'ip';
  }
}

function viewerIsBlocked(
  v: { deviceFingerprint: string | null; sessionId: string | null; ip: string },
  blocks: BlockedViewer[] = [],
): { isBlocked: boolean; blockId: string | null } {
  for (const b of blocks) {
    // Device-scoped block → do not match siblings on the same Wi‑Fi IP
    if (b.deviceFingerprint) {
      if (v.deviceFingerprint && b.deviceFingerprint === v.deviceFingerprint) {
        return { isBlocked: true, blockId: b.id };
      }
      continue;
    }
    if (b.sessionId) {
      if (v.sessionId && b.sessionId === v.sessionId) {
        return { isBlocked: true, blockId: b.id };
      }
      continue;
    }
    if (b.ipAddress && v.ip !== 'Unknown' && b.ipAddress === v.ip) {
      return { isBlocked: true, blockId: b.id };
    }
  }
  return { isBlocked: false, blockId: null };
}

function formatCoords(lat: number | null, lng: number | null): string | null {
  if (!isValidMapCoordinate(lat, lng)) return null;
  return `${lat!.toFixed(5)}, ${lng!.toFixed(5)}`;
}

/** One viewer per device — ignore server-only FILE_SERVED rows for grouping. */
function viewerGroupKey(log: AccessLog): string {
  if (log.deviceFingerprint) return `fp:${log.deviceFingerprint}`;
  const ip = log.ipAddress ?? 'unknown';
  const dev = log.device ?? '';
  const browser = log.browser ?? '';
  return `dev:${ip}|${dev}|${browser}`;
}

const VIEWER_ACTIONS = new Set([
  'VIEWED', 'DOWNLOADED', 'COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'PRINT_ATTEMPT',
  'TAB_SWITCH', 'SCROLL', 'IDLE', 'ACTIVE', 'FORWARDING_DETECTED', 'LOCATION_UPDATE',
]);

const RISK_COLOR: Record<string, string> = {
  LOW:      'text-green-400 bg-green-500/20',
  MEDIUM:   'text-yellow-400 bg-yellow-500/20',
  HIGH:     'text-orange-400 bg-orange-500/20',
  CRITICAL: 'text-red-400 bg-red-500/20',
};

const ACTION_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  VIEWED:             { icon: <Eye size={11} />,      label: 'Viewed',        color: 'text-blue-400' },
  DOWNLOADED:         { icon: <Download size={11} />,  label: 'Downloaded',    color: 'text-green-400' },
  COPIED:             { icon: <Copy size={11} />,      label: 'Copied',        color: 'text-yellow-400' },
  COPY_ATTEMPT:       { icon: <Copy size={11} />,      label: 'Copy Attempt',  color: 'text-orange-400' },
  SCREENSHOT_ATTEMPT: { icon: <Ban size={11} />,       label: 'Screenshot',    color: 'text-red-400' },
  TAB_SWITCH:         { icon: <ExternalLink size={11}/>, label: 'Tab Switch',  color: 'text-purple-400' },
  PRINT_ATTEMPT:      { icon: <Ban size={11} />,       label: 'Print Attempt', color: 'text-red-400' },
  ACTIVE:             { icon: <Eye size={11} />,       label: 'Active',        color: 'text-dna-400' },
  IDLE:               { icon: <Clock size={11} />,     label: 'Idle',          color: 'text-gray-400' },
  SCROLL:             { icon: <Eye size={11} />,       label: 'Scrolled',      color: 'text-gray-400' },
  LOCATION_UPDATE:   { icon: <MapPin size={11} />,    label: 'GPS Refined',   color: 'text-green-400' },
};

export function LinkIntelligencePage() {
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedViewer, setSelectedViewer] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [blockingViewer, setBlockingViewer] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    api.get(`${API_BASE_URL}/share/${encodeURIComponent(token)}/logs`)
      .then(r => {
        const payload = r.data as { link?: LinkInfo; success?: boolean };
        const linkData = payload?.link ?? null;
        if (linkData?.token) {
          setLink({ ...linkData, accessLogs: linkData.accessLogs ?? [], blockedViewers: linkData.blockedViewers ?? [] });
        } else {
          setLink(null);
          setLoadError('Invalid response from server');
        }
        setLoading(false);
      })
      .catch((err: { response?: { data?: { error?: string }; status?: number } }) => {
        setLink(null);
        setLoadError(err?.response?.data?.error ?? 'Failed to load link intelligence. Is the backend running?');
        setLoading(false);
      });
  };

  useEffect(load, [token]);

  // Group logs by unique viewer (IP + fingerprint)
  const viewers: Viewer[] = (() => {
    if (!link?.accessLogs?.length) return [];
    const map = new Map<string, Viewer>();
    let hop = 0;
    let seenDirectOnParent = false;
    const blocks = link.blockedViewers ?? [];

    const sorted = [...link.accessLogs]
      .filter(l => VIEWER_ACTIONS.has(l.action))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const log of sorted) {
      const key = viewerGroupKey(log);
      if (!map.has(key)) {
        // Only anchor a new viewer on a real open / forward — not scroll/idle alone
        if (log.action !== 'VIEWED' && log.action !== 'FORWARDING_DETECTED') continue;
        hop++;
        const accessKind = classifyAccessKind(log, seenDirectOnParent);
        if (accessKind === 'direct_recipient' || accessKind === 'direct_share') {
          seenDirectOnParent = true;
        }
        const base: Viewer = {
          id: key,
          ip: log.ipAddress ?? 'Unknown',
          country: log.country ?? 'Unknown',
          city: log.city ?? null,
          region: log.region ?? null,
          isp: log.isp ?? null,
          timezone: log.timezone ?? null,
          gpsCity: log.gpsCity ?? null,
          gpsVillage: log.gpsVillage ?? null,
          gpsMandal: log.gpsMandal ?? null,
          gpsDistrict: log.gpsDistrict ?? null,
          gpsState: log.gpsState ?? null,
          gpsPincode: log.gpsPincode ?? null,
          gpsFullAddress: log.gpsFullAddress ?? null,
          gpsAccuracy: log.gpsAccuracy ?? null,
          locationSource: log.locationSource ?? null,
          device: log.device ?? 'Unknown',
          browser: log.browser ?? 'Unknown',
          os: log.os ?? 'Unknown',
          riskLevel: log.riskLevel ?? 'LOW',
          firstSeen: log.createdAt,
          totalActions: 0,
          actions: [],
          hopNumber: hop,
          lat: sanitizeCoordinatePair(log.gpsLat, log.gpsLng)?.lat
            ?? sanitizeCoordinatePair(log.lat, log.lng)?.lat
            ?? null,
          lng: sanitizeCoordinatePair(log.gpsLat, log.gpsLng)?.lng
            ?? sanitizeCoordinatePair(log.lat, log.lng)?.lng
            ?? null,
          deviceFingerprint: log.deviceFingerprint ?? null,
          sessionId: log.sessionId ?? null,
          isBlocked: false,
          blockId: null,
          riskScore: 0,
          trustScore: 100,
          locationTrust: 'HIGH',
          locationInconsistent: false,
          riskFactors: [],
          alerts: [],
          suggestedActions: [],
          isVpn: false,
          isTor: false,
          isProxy: false,
          isDatacenter: false,
          recipientName: log.recipientName ?? null,
          priorLat: null,
          priorLng: null,
          accessKind,
        };
        const blockStatus = viewerIsBlocked(
          { deviceFingerprint: base.deviceFingerprint, sessionId: base.sessionId, ip: base.ip },
          blocks,
        );
        base.isBlocked = blockStatus.isBlocked;
        base.blockId = blockStatus.blockId;
        map.set(key, base);
      }
      const v = map.get(key)!;
      v.totalActions++;
      // Keep prior coordinates before merging newer GPS
      if (isValidMapCoordinate(v.lat, v.lng) && !v.priorLat) {
        /* first point becomes prior only after second unique point */
      }
      const beforeLat = v.lat;
      const beforeLng = v.lng;
      v.actions.push(log);
      mergeLocationFromLog(v, log);
      if (
        isValidMapCoordinate(beforeLat, beforeLng) &&
        isValidMapCoordinate(v.lat, v.lng) &&
        (beforeLat !== v.lat || beforeLng !== v.lng)
      ) {
        v.priorLat = beforeLat;
        v.priorLng = beforeLng;
      }
      if (log.recipientName) v.recipientName = log.recipientName;
      if (log.isVpn) v.isVpn = true;
      if (log.isTor) v.isTor = true;
      if (log.isProxy) v.isProxy = true;
      if (log.isDatacenter) v.isDatacenter = true;
      // Escalate to reshared if any later hop-link activity is seen
      if (v.accessKind !== 'reshared') {
        const laterKind = classifyAccessKind(log, true);
        if (laterKind === 'reshared') v.accessKind = 'reshared';
      }

      const evidence = parseRiskEvidence(log.riskFactors);
      for (const f of evidence.reasons) {
        if (!v.riskFactors.includes(f)) v.riskFactors.push(f);
      }
      for (const a of evidence.alerts) {
        if (!v.alerts.includes(a)) v.alerts.push(a);
      }
      for (const s of evidence.suggestedActions) {
        if (!v.suggestedActions.includes(s)) v.suggestedActions.push(s);
      }
      if (evidence.locationInconsistent) v.locationInconsistent = true;
      if (log.riskScore != null && log.riskScore >= v.riskScore) {
        v.riskScore = log.riskScore;
        const t = evidence.trustScore != null
          ? { trustScore: evidence.trustScore, locationTrust: evidence.locationTrust ?? trustFromRiskScore(log.riskScore).locationTrust }
          : trustFromRiskScore(log.riskScore);
        v.trustScore = t.trustScore;
        v.locationTrust = t.locationTrust;
      }
      if (log.riskLevel === 'CRITICAL' || (log.riskLevel === 'HIGH' && v.riskLevel !== 'CRITICAL')) {
        v.riskLevel = log.riskLevel!;
      }
      if (log.riskLevel === 'MEDIUM' && v.riskLevel === 'LOW') v.riskLevel = 'MEDIUM';
    }
    return Array.from(map.values());
  })();

  // Merge by country for the map summary
  const countryStats = viewers.reduce((acc, v) => {
    acc[v.country] = (acc[v.country] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <RefreshCw size={24} className="animate-spin text-dna-400" />
    </div>
  );

  if (!link) return (
    <div className="max-w-lg mx-auto text-center py-16">
      <p className="text-sm text-gray-400 mb-2">{loadError ?? 'Link not found'}</p>
      <div className="flex items-center justify-center gap-3">
        <Link to="/access-intelligence" className="text-dna-400 text-sm hover:underline flex items-center gap-1">
          <ArrowLeft size={14} /> Back to Tracking
        </Link>
        <button onClick={load} className="text-sm text-gray-400 hover:text-white">Retry</button>
      </div>
    </div>
  );

  const activeViewer = selectedViewer ? viewers.find(v => v.id === selectedViewer) : null;
  const trackingBackPath = link.vaultId
    ? `/access-intelligence?vaultId=${encodeURIComponent(link.vaultId)}`
    : '/access-intelligence';

  return (
    <div className="page-shell-wide w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to={trackingBackPath} className="text-gray-400 hover:text-white transition-colors" title="Back to this file’s share links">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 mb-0.5">Tracking</p>
          <h1 className="text-lg sm:text-xl font-bold text-white truncate" title={link.filename}>
            {link.filename}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Shared {formatDistanceToNow(new Date(link.createdAt))} ago
            {(link.hopLinkCount ?? 0) > 0 && (
              <span className="text-dna-400"> · {link.hopLinkCount} forward{link.hopLinkCount === 1 ? '' : 's'} tracked</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {link.isActive && !revoked ? (
            <button
              onClick={async () => {
                if (!confirm(`Stop access for “${link.filename}”? People with this link will no longer be able to open it.`)) return;
                setRevoking(true);
                try {
                  await api.delete(`${API_BASE_URL}/share/${token}`);
                  setRevoked(true);
                } catch { /* */ }
                setRevoking(false);
              }}
              disabled={revoking}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium rounded-lg transition-colors"
            >
              {revoking ? <RefreshCw size={12} className="animate-spin" /> : <XCircle size={12} />}
              Stop access
            </button>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium rounded-lg">
              <Ban size={12} /> Access stopped
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatCard icon={<Users size={14} />} label="Viewers" value={viewers.length} color="text-dna-400" />
        <StatCard icon={<Eye size={14} />} label="Views" value={link.viewCount} color="text-blue-400" />
        <StatCard icon={<Download size={14} />} label="Downloads" value={link.downloadCount} color="text-green-400" />
        <StatCard icon={<Globe size={14} />} label="Countries" value={Object.keys(countryStats).length} color="text-purple-400" />
        <StatCard
          icon={<AlertTriangle size={14} />}
          label="Risk Events"
          value={viewers.filter(v => v.riskLevel === 'HIGH' || v.riskLevel === 'CRITICAL').length}
          color="text-red-400"
        />
      </div>

      {/* Interactive World Map — file tracking visualization */}
      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
          <Globe size={14} className="text-dna-400" /> File Tracking Map — Where Your File Traveled
        </h2>

        <FileTrackingMap
          points={viewers
            .filter(v => isValidMapCoordinate(v.lat, v.lng))
            .map(v => ({
            lat: v.lat!, lng: v.lng!,
            label: `Hop ${v.hopNumber}`,
            hopNumber: v.hopNumber,
            country: v.country, city: v.gpsCity ?? v.city,
            device: v.device, ip: v.ip,
            riskLevel: v.riskLevel,
            totalActions: v.totalActions,
            gpsVillage: v.gpsVillage,
            gpsMandal: v.gpsMandal,
            gpsDistrict: v.gpsDistrict,
            gpsState: v.gpsState,
            gpsPincode: v.gpsPincode,
            gpsAccuracy: v.gpsAccuracy,
            gpsFullAddress: v.gpsFullAddress,
            locationSource: v.locationSource,
            accessKind: v.accessKind,
          }))}
          height="420px"
        />

        {viewers.length > 0 && viewers.every(v => !isValidMapCoordinate(v.lat, v.lng)) && (
          <p className="text-2xs text-yellow-500/90 mt-3 italic">
            {viewers.some(v => isPrivateIp(v.ip))
              ? 'Testing on localhost — IP geolocation is unavailable for local/private networks.'
              : 'No map coordinates yet. Turn ON GPS Location Tracking when sharing, then open the link and Allow location for street / village / mandal detail.'}
          </p>
        )}
        {viewers.some(v => isValidMapCoordinate(v.lat, v.lng) && v.locationSource === 'ip') && (
          <p className="text-2xs text-yellow-500/90 mt-3 italic">
            Some pins are IP-approximate (city/ISP). For exact street, latitude/longitude, district &amp; mandal: create the share with <strong className="text-yellow-300">GPS Location Tracking ON</strong> and Allow location in the browser when opening the link.
          </p>
        )}

        {/* Country breakdown below map */}
        {Object.keys(countryStats).length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            {Object.entries(countryStats)
              .sort(([,a], [,b]) => b - a)
              .map(([country, count]) => (
                <div key={country} className="bg-bg-elevated rounded-lg px-3 py-2 border border-bg-border flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <MapPin size={10} className="text-dna-400" />
                    <span className="text-2xs font-medium text-white">{country}</span>
                  </div>
                  <span className="text-2xs text-dna-400 font-bold">{count}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Viewers grid + activity detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Viewers list */}
        <div className="lg:col-span-1 space-y-2">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-2">
            <Users size={14} className="text-dna-400" /> Viewers ({viewers.length})
          </h2>
          {viewers.map(v => (
            <div key={v.id} className="space-y-1">
            <button
              onClick={() => setSelectedViewer(v.id === selectedViewer ? null : v.id)}
              className={`w-full text-left border rounded-lg p-3 transition-all ${
                !v.isBlocked
                  ? (v.id === selectedViewer
                    ? ACCESS_KIND_CARD[v.accessKind].selected
                    : ACCESS_KIND_CARD[v.accessKind].idle)
                  : v.id === selectedViewer
                    ? 'bg-bg-card border-dna-500/50 ring-1 ring-dna-500/20'
                    : 'bg-bg-card border-bg-border hover:border-dna-500/30'
              } ${v.isBlocked ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                    v.isBlocked ? 'bg-red-900 border-red-500 text-red-300'
                      : ACCESS_KIND_ICON[v.accessKind]
                  }`}>
                    {v.hopNumber}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white flex items-center gap-1.5 flex-wrap">
                      {v.accessKind === 'direct_recipient'
                        ? 'Direct Recipient'
                        : v.accessKind === 'direct_share'
                          ? 'Direct Share'
                          : `Viewer ${v.hopNumber}`}
                      <span className={`text-2xs px-1.5 py-0.5 rounded-full border font-semibold tracking-wide ${ACCESS_KIND_BADGE[v.accessKind]}`}>
                        {v.accessKind === 'reshared' ? 'RESHARED' : ACCESS_KIND_LABELS[v.accessKind].toUpperCase()}
                      </span>
                      {v.recipientName && <span className="text-gray-400 font-normal">· {v.recipientName}</span>}
                      {v.isBlocked && <span className="text-2xs text-red-400">Revoked</span>}
                      {(v.riskLevel === 'HIGH' || v.riskLevel === 'CRITICAL' || v.locationTrust === 'LOW') && (
                        <span className="text-2xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30">
                          {v.riskLevel === 'CRITICAL' ? 'Critical risk' : v.riskLevel === 'HIGH' ? 'High risk' : 'Low trust'}
                        </span>
                      )}
                    </p>
                    <p className="text-2xs text-gray-500">
                      {v.gpsVillage ?? v.gpsCity ?? v.city ?? v.country}{v.gpsDistrict ? `, ${v.gpsDistrict}` : v.region ? `, ${v.region}` : ''} · {v.ip}
                    </p>
                    {formatCoords(v.lat, v.lng) && (
                      <p className="text-2xs text-dna-400 font-mono">{formatCoords(v.lat, v.lng)}</p>
                    )}
                  </div>
                </div>
                <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${RISK_COLOR[v.riskLevel] ?? RISK_COLOR['LOW']}`}>
                  {v.riskLevel}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-2xs text-gray-500">
                <span className="flex items-center gap-1">
                  {v.device === 'Mobile' ? <Smartphone size={9} /> : <Monitor size={9} />}
                  {v.device}
                </span>
                <span>{v.browser} · {v.os}</span>
                <span>{v.totalActions} actions</span>
              </div>
            </button>
            {link.isActive && !revoked && (
              <div className="flex justify-end px-1">
                {v.isBlocked ? (
                  v.blockId && (
                    <button
                      onClick={async () => {
                        setBlockingViewer(v.id);
                        try {
                          await api.delete(`${API_BASE_URL}/share/${token}/block-viewer/${v.blockId}`);
                          load();
                        } catch { /* */ }
                        setBlockingViewer(null);
                      }}
                      disabled={blockingViewer === v.id}
                      className="text-2xs text-gray-400 hover:text-white"
                    >
                      Restore access
                    </button>
                  )
                ) : (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Revoke access for Viewer ${v.hopNumber}? They will be blocked from this link.`)) return;
                      setBlockingViewer(v.id);
                      try {
                        await api.post(`${API_BASE_URL}/share/${token}/block-viewer`, {
                          // Prefer device-only scope — laptop + phone often share one public IP
                          deviceFingerprint: v.deviceFingerprint || undefined,
                          sessionId: v.deviceFingerprint ? undefined : (v.sessionId || undefined),
                          ipAddress: (v.deviceFingerprint || v.sessionId)
                            ? undefined
                            : (v.ip !== 'Unknown' ? v.ip : undefined),
                          label: ACCESS_KIND_LABELS[v.accessKind],
                        });
                        load();
                      } catch { /* */ }
                      setBlockingViewer(null);
                    }}
                    disabled={blockingViewer === v.id}
                    className="text-2xs text-red-400 hover:text-red-300 flex items-center gap-1"
                  >
                    {blockingViewer === v.id ? <RefreshCw size={10} className="animate-spin" /> : <Ban size={10} />}
                    Revoke viewer
                  </button>
                )}
              </div>
            )}
            </div>
          ))}
        </div>

        {/* Activity detail for selected viewer */}
        <div className="lg:col-span-2">
          {activeViewer ? (
            <div className="card">
              <div className="flex items-center justify-between mb-4 gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2 flex-wrap">
                    <Eye size={14} className="text-dna-400 shrink-0" />
                    {ACCESS_KIND_LABELS[activeViewer.accessKind]} — Activity Log
                    {activeViewer.accessKind === 'reshared' && (
                      <span className={`text-2xs px-1.5 py-0.5 rounded-full border font-semibold ${ACCESS_KIND_BADGE.reshared}`}>
                        RESHARED
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-dna-300 mt-1 truncate" title={link.filename}>
                    File: <span className="text-white font-medium">{link.filename}</span>
                  </p>
                </div>
                <span className="text-2xs text-gray-500 shrink-0">
                  First seen {formatDistanceToNow(new Date(activeViewer.firstSeen))} ago
                </span>
              </div>

              {/* Viewer identity card */}
              <div className="bg-bg-elevated rounded-lg p-3 border border-bg-border mb-4 space-y-2 text-2xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div><span className="text-gray-500">IP:</span> <span className="text-white font-mono">{activeViewer.ip}</span></div>
                  <div><span className="text-gray-500">Device:</span> <span className="text-white">{activeViewer.device}</span></div>
                  <div><span className="text-gray-500">Browser:</span> <span className="text-white">{activeViewer.browser} · {activeViewer.os}</span></div>
                  <div><span className="text-gray-500">Risk:</span> <span className={RISK_COLOR[activeViewer.riskLevel]?.split(' ')[0] ?? 'text-green-400'}>{activeViewer.riskLevel} ({activeViewer.riskScore})</span></div>
                  <div><span className="text-gray-500">Location Trust:</span> <span className={
                    activeViewer.locationTrust === 'HIGH' ? 'text-green-400'
                      : activeViewer.locationTrust === 'MEDIUM' ? 'text-yellow-400' : 'text-orange-400'
                  }>{activeViewer.locationTrust} ({activeViewer.trustScore})</span></div>
                  {(activeViewer.isVpn || activeViewer.isTor || activeViewer.isProxy || activeViewer.isDatacenter) && (
                    <div className="col-span-full flex flex-wrap gap-1.5">
                      {activeViewer.isVpn && <span className="text-2xs px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300">VPN</span>}
                      {activeViewer.isTor && <span className="text-2xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">TOR</span>}
                      {activeViewer.isProxy && <span className="text-2xs px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300">Proxy</span>}
                      {activeViewer.isDatacenter && <span className="text-2xs px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300">Hosting</span>}
                    </div>
                  )}
                  {(activeViewer.riskLevel === 'HIGH' || activeViewer.riskLevel === 'CRITICAL' || activeViewer.locationTrust === 'LOW') && (
                    <div className="col-span-full">
                      <span className="inline-flex items-center gap-1 text-2xs px-2 py-1 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30">
                        <AlertTriangle size={10} /> Suspicious access — review reasons below (not auto-blocked)
                      </span>
                    </div>
                  )}
                  <div><span className="text-gray-500">First Seen:</span> <span className="text-white">{format(new Date(activeViewer.firstSeen), 'MMM d, yyyy · h:mm:ss a')}</span></div>
                  {activeViewer.isp && <div><span className="text-gray-500">ISP:</span> <span className="text-white">{activeViewer.isp}</span></div>}
                </div>
                {/* Location — GPS or IP fallback */}
                <div className="border-t border-bg-border pt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin size={12} className={
                      activeViewer.locationSource === 'gps' && (activeViewer.gpsAccuracy == null || activeViewer.gpsAccuracy <= 75)
                        ? 'text-green-400'
                        : 'text-yellow-400'
                    } />
                    <span className="text-2xs font-semibold text-white">
                      {locationLabel(activeViewer.gpsAccuracy, activeViewer.locationSource)}
                    </span>
                    {activeViewer.gpsAccuracy != null && (
                      <span className={`text-2xs ${activeViewer.gpsAccuracy < 100 ? 'text-green-400' : activeViewer.gpsAccuracy < 1000 ? 'text-yellow-400' : 'text-orange-400'}`}>
                        ±{activeViewer.gpsAccuracy < 1000 ? `${Math.round(activeViewer.gpsAccuracy)}m` : `${Math.round(activeViewer.gpsAccuracy / 1000)}km`}
                      </span>
                    )}
                  </div>

                  {activeViewer.gpsVillage || activeViewer.gpsFullAddress || activeViewer.lat != null ? (
                    <div className="bg-bg-card rounded-lg p-2.5 border border-dna-500/20 space-y-1">
                      {activeViewer.gpsFullAddress && (
                        <div className="text-2xs text-white mb-1">{activeViewer.gpsFullAddress}</div>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {activeViewer.gpsVillage && <div><span className="text-gray-500">Village:</span> <span className="text-dna-400 font-semibold">{activeViewer.gpsVillage}</span></div>}
                        {activeViewer.gpsMandal && <div><span className="text-gray-500">Mandal:</span> <span className="text-white">{activeViewer.gpsMandal}</span></div>}
                        {activeViewer.gpsDistrict && <div><span className="text-gray-500">District:</span> <span className="text-white">{activeViewer.gpsDistrict}</span></div>}
                        {(activeViewer.gpsCity || activeViewer.city) && (
                          <div><span className="text-gray-500">City:</span> <span className="text-white">{activeViewer.gpsCity ?? activeViewer.city}</span></div>
                        )}
                        {(activeViewer.gpsState || activeViewer.region) && (
                          <div><span className="text-gray-500">State:</span> <span className="text-white">{activeViewer.gpsState ?? activeViewer.region}</span></div>
                        )}
                        {activeViewer.gpsPincode && <div><span className="text-gray-500">Pincode:</span> <span className="text-white">{activeViewer.gpsPincode}</span></div>}
                        <div><span className="text-gray-500">Country:</span> <span className="text-white">{activeViewer.country}</span></div>
                      </div>
                      {formatCoords(activeViewer.lat, activeViewer.lng) && (
                        <div className="pt-1 border-t border-bg-border mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-gray-500">Coordinates:</span>{' '}
                          <span className="text-dna-400 font-mono">{formatCoords(activeViewer.lat, activeViewer.lng)}</span>
                          {activeViewer.locationSource === 'ip' && (
                            <span className="text-yellow-500">(IP approximate)</span>
                          )}
                          <a
                            href={googleMapsUrl(activeViewer.lat!, activeViewer.lng!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-2xs text-dna-400 hover:text-dna-300"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink size={10} /> Google Maps
                          </a>
                          {isValidMapCoordinate(activeViewer.priorLat, activeViewer.priorLng) && (
                            <a
                              href={googleMapsUrl(activeViewer.priorLat!, activeViewer.priorLng!)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-2xs text-gray-400 hover:text-white"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Prior location
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div><span className="text-gray-500">Country:</span> <span className="text-white">{activeViewer.country}</span></div>
                      {activeViewer.region && <div><span className="text-gray-500">State:</span> <span className="text-white">{activeViewer.region}</span></div>}
                      <div><span className="text-gray-500">City (IP):</span> <span className="text-yellow-400">{activeViewer.city ?? 'Unknown'}</span></div>
                      <div className="col-span-full text-2xs text-yellow-500 italic">⚠ IP-based location — accuracy ~50-200km. Viewer denied precise GPS access.</div>
                    </div>
                  )}
                  {activeViewer.timezone && <div className="mt-1"><span className="text-gray-500">Timezone:</span> <span className="text-white">{activeViewer.timezone}</span></div>}
                </div>
              </div>

              {activeViewer.riskFactors.filter(f => !/^No anomalies/i.test(f) && !/^GPS and IP consistent/i.test(f)).length > 0 && (
                <div className="mb-4 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                  <p className="text-2xs font-semibold text-orange-300 mb-2 flex items-center gap-1">
                    <AlertTriangle size={11} /> Location Trust &amp; Risk
                  </p>
                  <div className="grid grid-cols-2 gap-2 mb-2 text-2xs">
                    <div>Risk Score: <span className="text-white font-semibold">{activeViewer.riskScore}</span> · {activeViewer.riskLevel}</div>
                    <div>Location Trust: <span className="text-white font-semibold">{activeViewer.locationTrust}</span> ({activeViewer.trustScore})</div>
                  </div>
                  <p className="text-2xs text-gray-500 mb-1">Reasons</p>
                  <ul className="space-y-1 mb-3">
                    {activeViewer.riskFactors
                      .filter(f => !/^No anomalies/i.test(f) && !/^GPS and IP consistent/i.test(f))
                      .slice(0, 8)
                      .map((f, i) => (
                        <li key={i} className="text-2xs text-orange-200/90">✓ {f}</li>
                      ))}
                  </ul>
                  {activeViewer.suggestedActions.length > 0 && (
                    <>
                      <p className="text-2xs text-gray-500 mb-1">Suggested action</p>
                      <ul className="space-y-0.5">
                        {activeViewer.suggestedActions.map((s, i) => (
                          <li key={i} className="text-2xs text-gray-300">• {s}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {/* Action timeline */}
              <div className="space-y-1">
                {activeViewer.actions.map((log) => {
                  const cfg = ACTION_CONFIG[log.action] ?? { icon: <Eye size={11} />, label: log.action, color: 'text-gray-400' };
                  const gps = sanitizeCoordinatePair(log.gpsLat, log.gpsLng);
                  const ip = sanitizeCoordinatePair(log.lat, log.lng);
                  const logLat = gps?.lat ?? ip?.lat ?? null;
                  const logLng = gps?.lng ?? ip?.lng ?? null;
                  const logPlace = [log.gpsVillage, log.gpsMandal, log.gpsDistrict].filter(Boolean).join(', ')
                    || log.gpsCity
                    || log.city;
                  return (
                    <div key={log.id} className="flex items-center gap-3 bg-bg-elevated rounded-lg px-3 py-2 border border-bg-border">
                      <span className={`${cfg.color}`}>{cfg.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-white">{cfg.label}</span>
                        {(logPlace || formatCoords(logLat, logLng)) && (
                          <p className="text-2xs text-gray-500 truncate">
                            {logPlace && <span>{logPlace}</span>}
                            {logPlace && formatCoords(logLat, logLng) && ' · '}
                            {formatCoords(logLat, logLng) && (
                              <span className="font-mono text-dna-400/80">{formatCoords(logLat, logLng)}</span>
                            )}
                          </p>
                        )}
                      </div>
                      {log.screenResolution && <span className="text-2xs text-gray-600">{log.screenResolution}</span>}
                      {log.sessionDurationSec != null && <span className="text-2xs text-gray-600">{log.sessionDurationSec}s</span>}
                      <span className="text-2xs text-gray-500 whitespace-nowrap">{format(new Date(log.createdAt), 'MMM d, h:mm:ss a')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="card flex items-center justify-center py-16">
              <div className="text-center">
                <Users size={32} className="text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-gray-500">Select a viewer to see their activity</p>
                <p className="text-2xs text-gray-600 mt-1">Each unique person who accessed this link is tracked separately</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="card-sm text-center">
      <div className={`flex items-center justify-center gap-1 ${color} mb-1`}>{icon}</div>
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-2xs text-gray-500">{label}</p>
    </div>
  );
}
