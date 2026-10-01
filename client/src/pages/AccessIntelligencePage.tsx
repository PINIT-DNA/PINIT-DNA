import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Shield,
  Eye,
  Globe,
  Users,
  Clock,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';
import {
  api,
  listProtectedFileShares,
  getLiveTrackingMap,
  getVaultTracking,
  type ProtectedFileShare,
  type VaultTrackingDashboard,
} from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { formatDistanceToNow } from 'date-fns';
import { DashboardFilesMap, type DashboardFileMapPoint } from '../components/maps/DashboardFilesMap';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';
import { ShareSectionGuide } from '../components/nav/ShareSectionGuide';

interface ShareLink {
  id: string;
  token: string;
  vaultId?: string | null;
  assetId?: string | null;
  filename: string;
  createdAt: string;
  isActive: boolean;
  viewCount: number;
  downloadCount: number;
  maxViews: number | null;
  expiresAt: string | null;
  linkType?: string | null;
  sourceContext?: string | null;
  exchangeOrderId?: string | null;
  exchangeSealId?: string | null;
  licenseTier?: string | null;
  activityStats?: {
    uniqueViewers: number;
    views: number;
    downloads: number;
    securityEvents: number;
    countries: string[];
    lastActivityAt: string | null;
    hasHighRisk: boolean;
  };
  accessLogs: Array<{
    id: string;
    action: string;
    ipAddress: string | null;
    country: string | null;
    device: string | null;
    riskLevel: string | null;
    createdAt: string;
  }>;
}

export function AccessIntelligencePage() {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [fileShares, setFileShares] = useState<ProtectedFileShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const vaultFilter = searchParams.get('vaultId')?.trim() || null;
  const assetFilter = searchParams.get('assetId')?.trim() || null;
  const [loadError, setLoadError] = useState('');
  const [assetMap, setAssetMap] = useState<DashboardFileMapPoint[]>([]);
  const [vaultTrack, setVaultTrack] = useState<VaultTrackingDashboard | null>(null);

  const loadLinks = () => {
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const r = await api.get(`${API_BASE_URL}/share`);
        const data = (r.data as { links?: ShareLink[]; shareLinks?: ShareLink[] }).links
          ?? (r.data as { shareLinks?: ShareLink[] }).shareLinks
          ?? [];
        setLinks(data);
      } catch {
        setLinks([]);
        setLoadError(vaultFilter ? "Couldn't load activity for this asset." : "Couldn't load activity.");
      } finally {
        setLoading(false);
      }
    })();
  };

  const loadFileShares = () => {
    setLoadingFiles(true);
    listProtectedFileShares()
      .then(setFileShares)
      .catch(() => setFileShares([]))
      .finally(() => setLoadingFiles(false));
  };

  useEffect(() => {
    loadLinks();
    loadFileShares();
  }, []);

  useEffect(() => {
    if (!vaultFilter) {
      setAssetMap([]);
      setVaultTrack(null);
      return;
    }
    let cancelled = false;
    getLiveTrackingMap()
      .then((data) => {
        if (!cancelled) setAssetMap(data.points.filter((p) => p.vaultId === vaultFilter));
      })
      .catch(() => { if (!cancelled) setAssetMap([]); });
    getVaultTracking(vaultFilter)
      .then((t) => { if (!cancelled) setVaultTrack(t); })
      .catch(() => { if (!cancelled) setVaultTrack(null); });
    return () => { cancelled = true; };
  }, [vaultFilter]);

  // Vault â†’ Tracking lands on ?vaultId=â€¦ so all share links for that file stay visible.
  // Do not auto-jump to a single token (that hid other shares of the same file).

  const filteredLinks = useMemo(
    () => {
      if (vaultFilter) return links.filter((l) => l.vaultId === vaultFilter);
      if (assetFilter) return links.filter((l) => l.assetId === assetFilter);
      return links;
    },
    [links, vaultFilter, assetFilter],
  );

  const filteredFileShares = useMemo(
    () => (vaultFilter ? fileShares.filter((s) => s.vaultId === vaultFilter) : fileShares),
    [fileShares, vaultFilter],
  );

  const hubLinks = filteredLinks.filter((l) => l.linkType !== 'LIVING');
  const livingLinks = filteredLinks.filter((l) => l.linkType === 'LIVING');
  const activeLinks = hubLinks.filter((l) => l.isActive);
  const openFileShares = filteredFileShares.filter((s) => s.kind === 'file_open' && s.token);
  const exchangeLinks = filteredLinks.filter((l) => l.sourceContext === 'exchange_license');
  const exchangeCtx = exchangeLinks[0] ?? null;
  const totalFileViews = openFileShares.reduce((s, f) => s + (f.viewCount ?? 0), 0);
  const fileCountries = new Set(openFileShares.map((s) => s.geoCountry).filter(Boolean));
  const allChannelLinks = [...hubLinks, ...livingLinks];
  const totalViews = allChannelLinks.reduce((s, l) => s + (l.activityStats?.views ?? l.viewCount ?? 0), 0)
    + totalFileViews;
  const uniqueCountries = new Set([
    ...allChannelLinks.flatMap((l) => l.activityStats?.countries ?? []),
    ...[...fileCountries].filter((c): c is string => Boolean(c)),
  ]);
  const securityEvents = allChannelLinks.reduce(
    (s, l) => s + (l.activityStats?.securityEvents ?? 0),
    0,
  );
  const uniqueViewersCount = allChannelLinks.reduce((s, l) => s + (l.activityStats?.uniqueViewers ?? 0), 0);

  const assetGroups = useMemo(() => {
    const map = new Map<string, {
      vaultId: string;
      filename: string;
      token: string;
      views: number;
      viewers: number;
      countries: number;
      lastAt: string | null;
      isActive: boolean;
      kinds: string[];
    }>();
    const touch = (vaultId: string, filename: string, token: string, views: number, viewers: number, countries: string[], lastAt: string | null, isActive: boolean, kind: string) => {
      const key = vaultId || token;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          vaultId: key,
          filename,
          token,
          views,
          viewers,
          countries: countries.length,
          lastAt,
          isActive,
          kinds: [kind],
        });
        return;
      }
      prev.views += views;
      prev.viewers += viewers;
      prev.countries += countries.length;
      if (lastAt && (!prev.lastAt || lastAt > prev.lastAt)) prev.lastAt = lastAt;
      prev.isActive = prev.isActive || isActive;
      if (!prev.kinds.includes(kind)) prev.kinds.push(kind);
      if (views >= (prev.views - views)) prev.token = token;
    };
    for (const l of hubLinks) {
      touch(l.vaultId || l.token, l.filename, l.token, l.activityStats?.views ?? l.viewCount ?? 0, l.activityStats?.uniqueViewers ?? 0, l.activityStats?.countries ?? [], l.activityStats?.lastActivityAt ?? null, l.isActive, 'Link');
    }
    for (const l of livingLinks) {
      touch(l.vaultId || l.token, l.filename, l.token, l.activityStats?.views ?? l.viewCount ?? 0, l.activityStats?.uniqueViewers ?? 0, l.activityStats?.countries ?? [], l.activityStats?.lastActivityAt ?? null, l.isActive, 'Living page');
    }
    for (const s of openFileShares) {
      touch(s.vaultId, s.filename, s.token!, s.viewCount ?? 0, 0, s.geoCountry ? [s.geoCountry] : [], s.lastViewedAt ?? null, s.status === 'ACTIVE', 'File');
    }
    return [...map.values()].sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  }, [hubLinks, livingLinks, openFileShares]);

  const filterFilename =
    filteredLinks[0]?.filename
    ?? filteredFileShares[0]?.filename
    ?? null;

  const clearVaultFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('vaultId');
    setSearchParams(next, { replace: true });
  };

  const busy = loading || loadingFiles;

  if (busy && links.length === 0 && fileShares.length === 0 && !loadError) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw size={24} className="animate-spin text-dna-400" />
      </div>
    );
  }

  return (
    <div className="page-shell w-full max-w-5xl">
      <ShareSectionGuide current="sharing" />
      <div className="flex items-end justify-end mb-6 gap-3 mt-4">
        <button
          type="button"
          onClick={() => { loadLinks(); loadFileShares(); }}
          className="p-2 rounded-lg border border-bg-border text-gray-400 hover:text-white hover:border-dna-500/40 transition-colors shrink-0"
          title="Refresh"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-white">{loadError}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadLinks}>Try again</button>
        </div>
      )}

      {(vaultFilter || assetFilter) && (
        <div className="mb-5 space-y-4">
          {exchangeCtx && (
            <div className="rounded-xl border border-dna-500/30 bg-dna-500/5 px-4 py-3">
              <p className="text-2xs font-semibold text-dna-300 uppercase tracking-wide">Commercial context</p>
              <p className="text-sm font-semibold text-white mt-1">Pinit Exchange Â· licensed delivery</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-2xs text-gray-400 mt-2">
                <span>Asset</span><span className="text-white truncate">{exchangeCtx.filename}</span>
                <span>License</span><span className="text-white capitalize">{exchangeCtx.licenseTier || 'Licensed'}</span>
                {exchangeCtx.exchangeOrderId ? <><span>Order</span><span className="text-white">{exchangeCtx.exchangeOrderId}</span></> : null}
                {exchangeCtx.exchangeSealId ? <><span>License</span><span className="text-white">{exchangeCtx.exchangeSealId}</span></> : null}
              </div>
              <p className="text-2xs text-gray-500 mt-2">This is not shown on the public licensed viewer.</p>
            </div>
          )}
          {vaultFilter && (
          <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dna-500/30 bg-dna-500/10 px-3 py-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <VaultFileThumbnail
                vaultId={vaultFilter}
                fileName={filterFilename || vaultTrack?.filename || 'Asset'}
                mimeType="application/octet-stream"
                variant="compact"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {filterFilename || vaultTrack?.filename || 'Protected asset'}
                </p>
                <p className="text-2xs text-gray-400">
                  Protected
                  {vaultTrack?.status ? ` Â· ${vaultTrack.status}` : ''}
                  {activeLinks.length > 0 ? ' Â· Sharing active' : ' Â· No live share'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={clearVaultFilter}
              className="inline-flex items-center gap-1 text-2xs font-semibold text-dna-300 hover:text-white shrink-0"
            >
              <ArrowLeft size={12} />
              All assets
            </button>
          </div>
          {assetMap.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-white mb-2">Where this asset was accessed</p>
              <p className="text-2xs text-gray-500 mb-2">
                Approximate IP/network location unless the recipient allowed precise location.
              </p>
              <div className="h-56 rounded-xl overflow-hidden border border-bg-border">
                <DashboardFilesMap
                  points={assetMap}
                  fill
                  onSelectPoint={(p) => {
                    if (p.token) navigate(`/access-intelligence/${encodeURIComponent(p.token)}`);
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-bg-border bg-bg-elevated px-4 py-4">
              <p className="text-xs font-semibold text-white">Where this asset was accessed</p>
              <p className="text-2xs text-gray-500 mt-1">
                No location yet. Pins appear when someone opens a share and location is available (precise GPS only with permission; otherwise approximate IP).
              </p>
            </div>
          )}
          </>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatCard icon={<Users size={14} />} label="Viewers" value={uniqueViewersCount} color="text-cyan-400" />
        <StatCard icon={<Eye size={14} />} label="Views" value={totalViews} color="text-blue-400" />
        <StatCard icon={<Clock size={14} />} label="Downloads" value={hubLinks.reduce((s, l) => s + (l.activityStats?.downloads ?? l.downloadCount ?? 0), 0)} color="text-green-400" />
        <StatCard icon={<AlertTriangle size={14} />} label="Security events" value={securityEvents} color="text-orange-400" />
        <StatCard icon={<Globe size={14} />} label="Countries" value={uniqueCountries.size} color="text-orange-400" />
      </div>
      <p className="text-2xs text-gray-500 mb-4">
        One row per asset. Link, file, and living-page opens, reshares, location, and activity are on the same trail.
      </p>

      {assetGroups.length === 0 ? (
        <div className="card text-center py-16">
          <Shield size={40} className="text-gray-500 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {vaultFilter ? 'No activity yet' : 'No shares yet'}
          </p>
          <p className="text-2xs text-gray-500 mt-1">
            {vaultFilter
              ? 'Activity will appear here when someone opens this file, a living page, or a reshared link.'
              : 'Share a file or living page to start tracking.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {assetGroups.map((group) => (
            <button
              key={group.vaultId}
              type="button"
              onClick={() => navigate(`/access-intelligence/${encodeURIComponent(group.token)}`)}
              className="w-full text-left card hover:border-dna-500/30 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`w-2 h-2 rounded-full ${group.isActive ? 'bg-green-400' : 'bg-gray-500'}`} />
                    <p className="text-sm font-semibold text-white truncate">{group.filename}</p>
                    {group.kinds.map((kind) => (
                      <span key={kind} className="text-2xs text-dna-300 bg-dna-500/15 px-1.5 py-0.5 rounded">{kind}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 text-2xs text-gray-500 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Users size={10} className="text-dna-400" />
                      {group.viewers} viewer{group.viewers !== 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <Eye size={10} className="text-blue-400" />
                      {group.views} view{group.views !== 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <Globe size={10} className="text-orange-400" />
                      {group.countries} countr{group.countries !== 1 ? 'ies' : 'y'}
                    </span>
                    {group.lastAt && (
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        Last: {formatDistanceToNow(new Date(group.lastAt))} ago
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={14} className="text-gray-600 group-hover:text-dna-400 transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}
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
