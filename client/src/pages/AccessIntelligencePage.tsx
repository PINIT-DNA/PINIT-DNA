import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Shield,
  Eye,
  Download,
  Globe,
  Users,
  Clock,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  XCircle,
  Ban,
  Send,
  Copy,
  Check,
  MapPin,
  ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  api,
  listProtectedFileShares,
  revokeVaultTep,
  getLiveTrackingMap,
  getVaultTracking,
  type ProtectedFileShare,
  type VaultTrackingDashboard,
} from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { formatDistanceToNow } from 'date-fns';
import { DashboardFilesMap, type DashboardFileMapPoint } from '../components/maps/DashboardFilesMap';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';

interface ShareLink {
  id: string;
  token: string;
  vaultId?: string | null;
  filename: string;
  createdAt: string;
  isActive: boolean;
  viewCount: number;
  downloadCount: number;
  maxViews: number | null;
  expiresAt: string | null;
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

type TrackingTab = 'links' | 'files';

export function AccessIntelligencePage() {
  const [tab, setTab] = useState<TrackingTab>('links');
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [fileShares, setFileShares] = useState<ProtectedFileShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [copiedTep, setCopiedTep] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const vaultFilter = searchParams.get('vaultId')?.trim() || null;
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

  // Vault → Tracking lands on ?vaultId=… so all share links for that file stay visible.
  // Do not auto-jump to a single token (that hid other shares of the same file).

  const filteredLinks = useMemo(
    () => (vaultFilter ? links.filter((l) => l.vaultId === vaultFilter) : links),
    [links, vaultFilter],
  );

  const filteredFileShares = useMemo(
    () => (vaultFilter ? fileShares.filter((s) => s.vaultId === vaultFilter) : fileShares),
    [fileShares, vaultFilter],
  );

  const activeLinks = filteredLinks.filter((l) => l.isActive);
  const totalViews = filteredLinks.reduce((s, l) => s + (l.viewCount ?? 0), 0);
  const uniqueCountries = new Set(filteredLinks.flatMap((l) => (l.accessLogs ?? []).map((a) => a.country).filter(Boolean)));
  const securityActions = new Set(['COPY_ATTEMPT', 'PRINT_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'SCREEN_RECORDING_ATTEMPT', 'DOWNLOAD_FAILED', 'BLOCKED_REVOKED']);
  const securityEvents = filteredLinks.reduce(
    (s, l) => s + (l.accessLogs ?? []).filter((a) => securityActions.has(a.action)).length,
    0,
  );
  const uniqueViewers = new Set(
    filteredLinks.flatMap((l) => (l.accessLogs ?? []).filter((a) => a.action === 'VIEWED').map((a) => a.ipAddress || a.id)),
  );

  const openFileShares = filteredFileShares.filter((s) => s.kind === 'file_open' && s.token);
  const activeFiles = openFileShares.filter((s) => s.status === 'ACTIVE');
  const totalFileViews = openFileShares.reduce((s, f) => s + (f.viewCount ?? 0), 0);
  const fileCountries = new Set(openFileShares.map((s) => s.geoCountry).filter(Boolean));

  const filterFilename =
    filteredLinks[0]?.filename
    ?? filteredFileShares[0]?.filename
    ?? null;

  const clearVaultFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('vaultId');
    setSearchParams(next, { replace: true });
  };
  const copyText = async (value: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTep(value);
      setTimeout(() => setCopiedTep(null), 1600);
      toast.success(okMsg);
    } catch {
      toast.error('Could not copy');
    }
  };

  const revokeFileShare = async (share: ProtectedFileShare) => {
    if (share.kind === 'file_open' && share.token) {
      if (!confirm(`Revoke Share File open link ${share.token}? New opens will be blocked.`)) return;
      try {
        await api.delete(`${API_BASE_URL}/share/${share.token}`);
        setFileShares((prev) =>
          prev.map((s) => (s.id === share.id ? { ...s, status: 'REVOKED' } : s)),
        );
        toast.success('Share File link revoked');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Revoke failed');
      }
      return;
    }

    if (!share.tepCode) return;
    if (!confirm(`Revoke tracking for ${share.tepCode}? This marks the shared file package as revoked.`)) return;
    try {
      await revokeVaultTep(share.vaultId, share.tepCode, 'Revoked from Asset Activity');
      setFileShares((prev) =>
        prev.map((s) => (s.id === share.id ? { ...s, status: 'REVOKED' } : s)),
      );
      toast.success('Share File tracking revoked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed');
    }
  };

  const openAccessIntelligence = (share: ProtectedFileShare) => {
    if (share.kind === 'file_open' && share.token) {
      navigate(`/access-intelligence/${encodeURIComponent(share.token)}`);
      return;
    }
    const related = openFileShares.find((s) => s.vaultId === share.vaultId && s.token);
    if (related?.token) {
      navigate(`/access-intelligence/${encodeURIComponent(related.token)}`);
      return;
    }
    toast.error('No activity view for this item — use a Pinit open Share File row');
  };

  const busy = tab === 'links' ? loading : loadingFiles;

  if (busy && (tab === 'links' ? links.length === 0 : fileShares.length === 0) && !loadError) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw size={24} className="animate-spin text-dna-400" />
      </div>
    );
  }

  return (
    <div className="page-shell w-full max-w-5xl">
      <div className="flex items-end justify-between mb-6 gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 mb-1">
            {vaultFilter ? 'This asset' : 'All assets'}
          </p>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Shield size={22} className="text-dna-400" />
            Asset Activity
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            See who accessed {vaultFilter ? 'this asset' : 'your assets'} and what happened.
          </p>
        </div>
        <button
          type="button"
          onClick={() => (tab === 'links' ? loadLinks() : loadFileShares())}
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

      {vaultFilter && (
        <div className="mb-5 space-y-4">
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
                  {vaultTrack?.status ? ` · ${vaultTrack.status}` : ''}
                  {activeLinks.length > 0 ? ' · Sharing active' : ' · No live share'}
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
                <DashboardFilesMap points={assetMap} fill />
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
        </div>
      )}

      <div className="flex gap-2 mb-5">
        <TabButton
          active={tab === 'links'}
          onClick={() => setTab('links')}
          icon={<Shield size={13} />}
          label="Share Links"
          count={filteredLinks.length}
        />
        <TabButton
          active={tab === 'files'}
          onClick={() => setTab('files')}
          icon={<Send size={13} />}
          label="Share Files"
          count={openFileShares.length}
        />
      </div>

      {tab === 'links' ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            <StatCard icon={<Users size={14} />} label="Viewers" value={uniqueViewers.size} color="text-cyan-400" />
            <StatCard icon={<Eye size={14} />} label="Views" value={totalViews} color="text-blue-400" />
            <StatCard icon={<Clock size={14} />} label="Downloads" value={filteredLinks.reduce((s, l) => s + (l.downloadCount ?? 0), 0)} color="text-green-400" />
            <StatCard icon={<AlertTriangle size={14} />} label="Security events" value={securityEvents} color="text-orange-400" />
            <StatCard icon={<Globe size={14} />} label="Countries" value={uniqueCountries.size} color="text-orange-400" />
          </div>

          {filteredLinks.length === 0 ? (
            <div className="card text-center py-16">
              <Shield size={40} className="text-gray-500 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                {vaultFilter ? 'No activity yet' : 'No share links yet'}
              </p>
              <p className="text-2xs text-gray-500 mt-1">
                {vaultFilter
                  ? 'Activity will appear here when someone accesses or interacts with your shared asset.'
                  : 'Go to My Assets → Share to create your first tracked link'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLinks
                .slice()
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((link) => {
                  const logs = link.accessLogs ?? [];
                  const uniqueIps = new Set(logs.filter((l) => l.action === 'VIEWED').map((l) => l.ipAddress).filter(Boolean));
                  const hasRisk = logs.some((l) => l.riskLevel === 'HIGH' || l.riskLevel === 'CRITICAL');
                  const countries = new Set(logs.map((l) => l.country).filter(Boolean));
                  const lastAccess = logs.length > 0 ? logs[logs.length - 1] : null;

                  return (
                    <button
                      key={link.id}
                      type="button"
                      onClick={() => navigate(`/access-intelligence/${encodeURIComponent(link.token)}`)}
                      className="w-full text-left card hover:border-dna-500/30 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`w-2 h-2 rounded-full ${link.isActive ? 'bg-green-400' : 'bg-gray-500'}`} />
                            <p className="text-sm font-semibold text-white truncate">{link.filename}</p>
                            {hasRisk && (
                              <span className="flex items-center gap-1 text-2xs text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded">
                                <AlertTriangle size={9} /> Risk
                              </span>
                            )}
                          </div>
                          <p className="text-2xs text-gray-500 mb-2">
                            Shared {formatDistanceToNow(new Date(link.createdAt))} ago
                            {link.isActive ? ' · Live' : ' · Stopped'}
                          </p>

                          <div className="flex items-center gap-4 text-2xs text-gray-500 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Users size={10} className="text-dna-400" />
                              {uniqueIps.size} viewer{uniqueIps.size !== 1 ? 's' : ''}
                            </span>
                            <span className="flex items-center gap-1">
                              <Eye size={10} className="text-blue-400" />
                              {link.viewCount} view{link.viewCount !== 1 ? 's' : ''}
                            </span>
                            <span className="flex items-center gap-1">
                              <Download size={10} className="text-green-400" />
                              {link.downloadCount ?? 0} download{(link.downloadCount ?? 0) !== 1 ? 's' : ''}
                            </span>
                            <span className="flex items-center gap-1">
                              <Globe size={10} className="text-orange-400" />
                              {countries.size} countr{countries.size !== 1 ? 'ies' : 'y'}
                            </span>
                            {lastAccess && (
                              <span className="flex items-center gap-1">
                                <Clock size={10} />
                                Last: {formatDistanceToNow(new Date(lastAccess.createdAt))} ago
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1.5 shrink-0">
                          {link.isActive ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!confirm(`Stop access for “${link.filename}”? People with this link will no longer be able to open it.`)) return;
                                api.delete(`${API_BASE_URL}/share/${link.token}`).then(() => {
                                  setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, isActive: false } : l)));
                                });
                              }}
                              className="flex items-center gap-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-2xs font-medium rounded-lg transition-colors"
                            >
                              <XCircle size={10} /> Stop access
                            </button>
                          ) : (
                            <span className="flex items-center gap-1 px-2 py-1 bg-gray-500/10 border border-gray-500/30 text-gray-500 text-2xs rounded-lg">
                              <Ban size={10} /> Stopped
                            </span>
                          )}
                          <ChevronRight size={14} className="text-gray-600 group-hover:text-dna-400 transition-colors mx-auto" />
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard icon={<Send size={14} />} label="File shares" value={openFileShares.length} color="text-dna-400" />
            <StatCard icon={<Eye size={14} />} label="Active" value={activeFiles.length} color="text-green-400" />
            <StatCard icon={<Users size={14} />} label="Views" value={totalFileViews} color="text-blue-400" />
            <StatCard icon={<Globe size={14} />} label="Countries" value={fileCountries.size} color="text-orange-400" />
          </div>

          {openFileShares.length === 0 ? (
            <div className="card text-center py-16">
              <Send size={40} className="text-gray-500 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No shared assets tracked yet</p>
              <p className="text-2xs text-gray-500 mt-1">
                From My Assets, use Share File. When someone opens it in Pinit, activity shows up here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {openFileShares.map((share) => {
                const locationLabel = [share.geoCity, share.geoCountry].filter(Boolean).join(', ') || null;
                const isActive = share.status === 'ACTIVE';
                const statusColor = isActive ? 'bg-green-400' : 'bg-gray-500';
                const token = share.token!;

                return (
                  <button
                    key={`file_open-${share.id}`}
                    type="button"
                    onClick={() => openAccessIntelligence(share)}
                    className="w-full text-left card hover:border-dna-500/30 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                          <p className="text-sm font-semibold text-white truncate group-hover:text-dna-300 transition-colors">
                            {share.filename}
                          </p>
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-dna-500/15 text-dna-300 border border-dna-500/25">
                            Share File
                          </span>
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-bg-elevated text-gray-400 border border-bg-border">
                            {share.status}
                          </span>
                        </div>
                        <p className="text-2xs text-gray-500 mb-2 truncate">
                          Shared {formatDistanceToNow(new Date(share.createdAt))} ago
                        </p>
                        <div className="flex items-center gap-4 text-2xs text-gray-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Eye size={10} className="text-blue-400" />
                            {share.viewCount} view{share.viewCount !== 1 ? 's' : ''}
                          </span>
                          <span className="flex items-center gap-1">
                            <Download size={10} className="text-green-400" />
                            {share.downloadCount} download{share.downloadCount !== 1 ? 's' : ''}
                          </span>
                          {locationLabel && (
                            <span className="flex items-center gap-1">
                              <MapPin size={10} className="text-orange-400" />
                              {locationLabel}
                            </span>
                          )}
                          {share.deviceContext && (
                            <span className="flex items-center gap-1 capitalize">
                              <Users size={10} className="text-dna-400" />
                              {share.deviceContext}
                            </span>
                          )}
                          {share.lastViewedAt && (
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              Last: {formatDistanceToNow(new Date(share.lastViewedAt))} ago
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyText(token, 'Token copied');
                          }}
                          className="flex items-center gap-1 px-2 py-1 bg-bg-elevated hover:bg-dna-500/10 border border-bg-border text-gray-300 text-2xs font-medium rounded-lg transition-colors"
                        >
                          {copiedTep === token ? <Check size={10} /> : <Copy size={10} />}
                          {copiedTep === token ? 'Copied' : 'Copy'}
                        </button>
                        {isActive ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void revokeFileShare(share);
                            }}
                            className="flex items-center gap-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-2xs font-medium rounded-lg transition-colors"
                          >
                            <XCircle size={10} /> Revoke
                          </button>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-1 bg-gray-500/10 border border-gray-500/30 text-gray-500 text-2xs rounded-lg">
                            <Ban size={10} /> Revoked
                          </span>
                        )}
                        <ChevronRight size={14} className="text-gray-600 group-hover:text-dna-400 transition-colors mx-auto" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
        active
          ? 'bg-dna-500/15 border-dna-500/40 text-white'
          : 'bg-bg-elevated border-bg-border text-gray-400 hover:text-white hover:border-dna-500/30'
      }`}
    >
      {icon}
      {label}
      <span className={`text-2xs px-1.5 py-0.5 rounded-md ${active ? 'bg-dna-500/25 text-dna-300' : 'bg-bg-surface text-gray-500'}`}>
        {count}
      </span>
    </button>
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
