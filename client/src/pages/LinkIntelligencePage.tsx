import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Globe, Eye, Download, Copy, Ban, Shield,
  Users, Clock, Smartphone, Monitor, MapPin, AlertTriangle, ExternalLink, XCircle,
} from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { formatDistanceToNow, format } from 'date-fns';
import { FileTrackingMap } from '../components/maps/FileTrackingMap';

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
  sessionDurationSec: number | null;
  recipientName: string | null;
  deviceFingerprint: string | null;
}

interface LinkInfo {
  id: string;
  token: string;
  filename: string;
  createdAt: string;
  expiresAt: string | null;
  maxViews: number | null;
  viewCount: number;
  downloadCount: number;
  isActive: boolean;
  allowDownload: boolean;
  accessLogs: AccessLog[];
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
}

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
};

export function LinkIntelligencePage() {
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedViewer, setSelectedViewer] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`${API_BASE_URL}/share/${token}/logs`)
      .then(r => { setLink((r.data as any).link ?? r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(load, [token]);

  // Group logs by unique viewer (IP + fingerprint)
  const viewers: Viewer[] = (() => {
    if (!link?.accessLogs?.length) return [];
    const map = new Map<string, Viewer>();
    let hop = 0;

    const sorted = [...link.accessLogs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const log of sorted) {
      const key = log.deviceFingerprint || log.ipAddress || log.sessionId || log.id;
      if (!map.has(key)) {
        hop++;
        map.set(key, {
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
          lat: log.gpsLat ?? null,
          lng: log.gpsLng ?? null,
        });
      }
      const v = map.get(key)!;
      v.totalActions++;
      v.actions.push(log);
      if (log.riskLevel === 'CRITICAL' || (log.riskLevel === 'HIGH' && v.riskLevel !== 'CRITICAL')) {
        v.riskLevel = log.riskLevel!;
      }
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
    <div className="text-center py-16 text-gray-500">Link not found</div>
  );

  const activeViewer = selectedViewer ? viewers.find(v => v.id === selectedViewer) : null;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/timeline" className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield size={18} className="text-dna-400" />
            Link Intelligence
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {link.filename} · Token: {link.token.slice(0, 12)}... · Created {formatDistanceToNow(new Date(link.createdAt))} ago
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {link.isActive && !revoked ? (
            <button
              onClick={async () => {
                if (!confirm('Revoke this link? All active sessions will be terminated immediately.')) return;
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
              Revoke Link
            </button>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium rounded-lg">
              <Ban size={12} /> Revoked
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatCard icon={<Users size={14} />} label="Unique Viewers" value={viewers.length} color="text-dna-400" />
        <StatCard icon={<Eye size={14} />} label="Total Views" value={link.viewCount} color="text-blue-400" />
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
          points={viewers.filter(v => v.lat && v.lng).map(v => ({
            lat: v.lat!, lng: v.lng!,
            label: `Hop ${v.hopNumber}`,
            hopNumber: v.hopNumber,
            country: v.country, city: v.city,
            device: v.device, ip: v.ip,
            riskLevel: v.riskLevel,
            totalActions: v.totalActions,
            gpsVillage: v.gpsVillage,
            gpsMandal: v.gpsMandal,
            gpsDistrict: v.gpsDistrict,
            gpsState: v.gpsState,
            gpsPincode: v.gpsPincode,
            gpsAccuracy: v.gpsAccuracy,
          }))}
          height="420px"
        />

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
            <button
              key={v.id}
              onClick={() => setSelectedViewer(v.id === selectedViewer ? null : v.id)}
              className={`w-full text-left bg-bg-card border rounded-lg p-3 transition-all ${
                v.id === selectedViewer
                  ? 'border-dna-500/50 ring-1 ring-dna-500/20'
                  : 'border-bg-border hover:border-dna-500/30'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                    v.hopNumber === 1 ? 'bg-dna-600 border-dna-400 text-white' : 'bg-orange-900 border-orange-500 text-orange-300'
                  }`}>
                    {v.hopNumber}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white">
                      {v.hopNumber === 1 ? 'Direct Recipient' : `Viewer ${v.hopNumber}`}
                    </p>
                    <p className="text-2xs text-gray-500">{v.gpsCity ?? v.city ?? v.country}{v.region ? `, ${v.region}` : ''}, {v.country} · {v.ip}</p>
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
          ))}
        </div>

        {/* Activity detail for selected viewer */}
        <div className="lg:col-span-2">
          {activeViewer ? (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Eye size={14} className="text-dna-400" />
                  Viewer {activeViewer.hopNumber} — Activity Log
                </h2>
                <span className="text-2xs text-gray-500">
                  First seen {formatDistanceToNow(new Date(activeViewer.firstSeen))} ago
                </span>
              </div>

              {/* Viewer identity card */}
              <div className="bg-bg-elevated rounded-lg p-3 border border-bg-border mb-4 space-y-2 text-2xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div><span className="text-gray-500">IP:</span> <span className="text-white font-mono">{activeViewer.ip}</span></div>
                  <div><span className="text-gray-500">Device:</span> <span className="text-white">{activeViewer.device}</span></div>
                  <div><span className="text-gray-500">Browser:</span> <span className="text-white">{activeViewer.browser} · {activeViewer.os}</span></div>
                  <div><span className="text-gray-500">Risk:</span> <span className={RISK_COLOR[activeViewer.riskLevel]?.split(' ')[0] ?? 'text-green-400'}>{activeViewer.riskLevel}</span></div>
                  <div><span className="text-gray-500">First Seen:</span> <span className="text-white">{format(new Date(activeViewer.firstSeen), 'MMM d, yyyy · h:mm:ss a')}</span></div>
                  {activeViewer.isp && <div><span className="text-gray-500">ISP:</span> <span className="text-white">{activeViewer.isp}</span></div>}
                </div>
                {/* Location — GPS or IP fallback */}
                <div className="border-t border-bg-border pt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin size={12} className={activeViewer.locationSource === 'gps' ? 'text-green-400' : 'text-yellow-400'} />
                    <span className="text-2xs font-semibold text-white">
                      Location Source: {activeViewer.locationSource === 'gps' ? '📍 GPS (Precise)' : '🌐 IP Approximation'}
                    </span>
                    {activeViewer.gpsAccuracy && (
                      <span className="text-2xs text-green-400">±{Math.round(activeViewer.gpsAccuracy)}m accuracy</span>
                    )}
                  </div>

                  {activeViewer.gpsVillage || activeViewer.gpsFullAddress ? (
                    <div className="bg-bg-card rounded-lg p-2.5 border border-dna-500/20 space-y-1">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {activeViewer.gpsVillage && <div><span className="text-gray-500">Village:</span> <span className="text-dna-400 font-semibold">{activeViewer.gpsVillage}</span></div>}
                        {activeViewer.gpsMandal && <div><span className="text-gray-500">Mandal:</span> <span className="text-white">{activeViewer.gpsMandal}</span></div>}
                        {activeViewer.gpsDistrict && <div><span className="text-gray-500">District:</span> <span className="text-white">{activeViewer.gpsDistrict}</span></div>}
                        {activeViewer.gpsState && <div><span className="text-gray-500">State:</span> <span className="text-white">{activeViewer.gpsState}</span></div>}
                        {activeViewer.gpsPincode && <div><span className="text-gray-500">Pincode:</span> <span className="text-white">{activeViewer.gpsPincode}</span></div>}
                        <div><span className="text-gray-500">Country:</span> <span className="text-white">{activeViewer.country}</span></div>
                      </div>
                      {activeViewer.lat && activeViewer.lng && (
                        <div className="pt-1 border-t border-bg-border mt-1">
                          <span className="text-gray-500">Coordinates:</span> <span className="text-dna-400 font-mono">{activeViewer.lat.toFixed(5)}, {activeViewer.lng.toFixed(5)}</span>
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

              {/* Action timeline */}
              <div className="space-y-1">
                {activeViewer.actions.map((log) => {
                  const cfg = ACTION_CONFIG[log.action] ?? { icon: <Eye size={11} />, label: log.action, color: 'text-gray-400' };
                  return (
                    <div key={log.id} className="flex items-center gap-3 bg-bg-elevated rounded-lg px-3 py-2 border border-bg-border">
                      <span className={`${cfg.color}`}>{cfg.icon}</span>
                      <span className="text-xs text-white flex-1">{cfg.label}</span>
                      {log.screenResolution && <span className="text-2xs text-gray-600">{log.screenResolution}</span>}
                      {log.sessionDurationSec != null && <span className="text-2xs text-gray-600">{log.sessionDurationSec}s</span>}
                      <span className="text-2xs text-gray-500">{format(new Date(log.createdAt), 'MMM d, h:mm:ss a')}</span>
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
