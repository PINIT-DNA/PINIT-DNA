/**
 * Publish Guardian — Protected Posts dashboard.
 * Additive UI — does not modify Vault/Monitoring pages.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Shield, Search, RefreshCw, ExternalLink, Eye, Archive,
  AlertTriangle, Activity, Radio,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../../config/api.config';
import { api } from '../../services/dashboard.api';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { cn } from '../../components/ui/utils';
import { BRAND } from '../../config/brand.config';

interface ProtectedPostRow {
  id: string;
  platform: string;
  postUrl: string | null;
  platformPostId?: string | null;
  ownerAccount: string | null;
  status: string;
  monitorStatus: string;
  discoveriesCount: number;
  tamperedCount: number;
  riskScore: number;
  riskSeverity?: string;
  lastScanAt: string | null;
  lastDiscoveryAt: string | null;
  nextScanAt?: string | null;
  publishedAt: string | null;
  registeredAt: string;
  certificateId: string | null;
  vaultId: string | null;
  dnaRecordId: string | null;
  mediaType: string;
  thumbnail: string | null;
  caption: string | null;
  _count?: { discoveries: number; timeline: number };
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'muted'> = {
  REGISTERED: 'info',
  PROTECTED: 'success',
  MONITORING: 'success',
  DISCOVERY: 'warning',
  TAMPERING: 'danger',
  INVESTIGATION: 'warning',
  EVIDENCE: 'info',
  RESOLVED: 'muted',
  FAILED: 'danger',
  ARCHIVED: 'muted',
};

function platformLabel(p: string) {
  const map: Record<string, string> = {
    instagram: 'Instagram',
    facebook: 'Facebook',
    x: 'X',
    youtube: 'YouTube',
    pinterest: 'Pinterest',
    linkedin: 'LinkedIn',
    telegram: 'Telegram',
    github: 'GitHub',
    web: 'Web',
  };
  return map[p] ?? p;
}

export function ProtectedPostsPage() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<ProtectedPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [stats, setStats] = useState<{
    protectedPosts: number;
    monitoringJobs: { running: number; paused: number; failed: number; pending: number; total: number };
    totalDiscoveries: number;
    tamperedAssets: number;
    highRisk: number;
    averageScanTimeMs: number | null;
    lastScanAt: string | null;
    nextScanAt: string | null;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (platform !== 'ALL') params.set('platform', platform);
      if (status !== 'ALL') params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      const [listRes, statsRes] = await Promise.all([
        api.get<{ posts: ProtectedPostRow[] }>(`${API_BASE_URL}/posts?${params.toString()}`),
        api
          .get<{ stats: NonNullable<typeof stats> }>(`${API_BASE_URL}/posts/stats`)
          .catch((): { data: { stats: NonNullable<typeof stats> } } | null => null),
      ]);
      setPosts(listRes.data.posts ?? []);
      if (statsRes?.data?.stats) setStats(statsRes.data.stats);
    } catch {
      toast.error('Failed to load protected posts');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [platform, status]);

  const filtered = useMemo(() => posts, [posts]);

  const archive = async (id: string) => {
    if (!window.confirm('Archive this protected post? Vault and DNA stay intact.')) return;
    try {
      await api.delete(`${API_BASE_URL}/posts/${id}`);
      toast.success('Post archived');
      void load();
    } catch {
      toast.error('Archive failed');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="text-dna-400" size={22} />
            Protected Posts
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Publish Guardian tracking — posts protected via the {BRAND.name} Chrome extension
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost text-xs flex items-center gap-1.5 self-start"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input pl-9 text-sm w-full"
            placeholder="Search URL, account, caption…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
          />
        </div>
        <select className="input text-sm w-full sm:w-40" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="ALL">All platforms</option>
          {['instagram', 'facebook', 'x', 'pinterest', 'linkedin', 'youtube', 'github', 'telegram', 'web'].map((p) => (
            <option key={p} value={p}>{platformLabel(p)}</option>
          ))}
        </select>
        <select className="input text-sm w-full sm:w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ALL">All statuses</option>
          {['PROTECTED', 'MONITORING', 'DISCOVERY', 'TAMPERING', 'INVESTIGATION', 'RESOLVED', 'FAILED', 'ARCHIVED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { label: 'Protected', value: stats.protectedPosts },
            { label: 'Running', value: stats.monitoringJobs.running },
            { label: 'Paused', value: stats.monitoringJobs.paused },
            { label: 'Failed', value: stats.monitoringJobs.failed },
            { label: 'Discoveries', value: stats.totalDiscoveries },
            { label: 'Tampered', value: stats.tamperedAssets },
            { label: 'High risk', value: stats.highRisk },
            { label: 'Avg scan', value: stats.averageScanTimeMs != null ? `${stats.averageScanTimeMs}ms` : '—' },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-bg-border bg-bg-card px-3 py-2.5">
              <p className="text-2xs text-gray-500 uppercase tracking-wider">{m.label}</p>
              <p className="text-lg font-bold text-white mt-0.5">{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No protected posts yet"
          description="Install the Pinit Chrome extension and enable Publish Guardian on Instagram, X, or other supported sites. New publishes will appear here automatically."
        />
      ) : (
        <div className="rounded-xl border border-bg-border overflow-hidden bg-bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wider text-gray-500 border-b border-bg-border bg-bg-elevated">
                  <th className="px-3 py-2.5">Post</th>
                  <th className="px-3 py-2.5">Platform</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Monitoring</th>
                  <th className="px-3 py-2.5">Discoveries</th>
                  <th className="px-3 py-2.5">Tampered</th>
                  <th className="px-3 py-2.5">Risk</th>
                  <th className="px-3 py-2.5">Last scan</th>
                  <th className="px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-bg-border/60 hover:bg-bg-elevated/50 cursor-pointer"
                    onClick={() => navigate(`/protected-posts/${p.id}`)}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 min-w-[180px]">
                        <div className="w-10 h-10 rounded-lg bg-bg-elevated border border-bg-border flex items-center justify-center text-2xs text-gray-500 shrink-0">
                          {p.mediaType === 'VIDEO' ? 'VID' : 'IMG'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate max-w-[220px]">
                            {p.caption || p.ownerAccount || p.platformPostId || p.id.slice(0, 8)}
                          </p>
                          <p className="text-2xs text-gray-500 truncate max-w-[220px]">
                            {p.postUrl ?? 'URL pending'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-gray-300">{platformLabel(p.platform)}</td>
                    <td className="px-3 py-3">
                      <Badge variant={STATUS_VARIANT[p.status] ?? 'muted'}>{p.status}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn(
                        'text-2xs font-semibold',
                        p.monitorStatus === 'RUNNING' || p.monitorStatus === 'ACTIVE' ? 'text-emerald-400'
                          : p.monitorStatus === 'FAILED' ? 'text-red-400'
                            : p.monitorStatus === 'PAUSED' ? 'text-amber-400'
                              : 'text-gray-500',
                      )}>
                        {p.monitorStatus}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-white font-medium">{p.discoveriesCount}</td>
                    <td className="px-3 py-3">
                      <span className={p.tamperedCount > 0 ? 'text-amber-400 font-semibold' : 'text-gray-500'}>
                        {p.tamperedCount}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn(
                        'font-semibold',
                        p.riskScore >= 80 ? 'text-red-400' : p.riskScore >= 50 ? 'text-amber-400' : 'text-gray-400',
                      )}>
                        {p.riskScore}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-2xs text-gray-500 whitespace-nowrap">
                      {p.lastScanAt
                        ? formatDistanceToNow(new Date(p.lastScanAt), { addSuffix: true })
                        : '—'}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <Link
                          to={`/protected-posts/${p.id}`}
                          className="btn-ghost btn-icon"
                          title="Timeline"
                        >
                          <Eye size={14} />
                        </Link>
                        {p.vaultId && (
                          <Link to="/vault" className="btn-ghost btn-icon" title="Vault">
                            <Archive size={14} />
                          </Link>
                        )}
                        <Link
                          to={BRAND.investigationPath}
                          className="btn-ghost btn-icon"
                          title="Investigate"
                        >
                          <Activity size={14} />
                        </Link>
                        <Link to="/monitoring" className="btn-ghost btn-icon" title="Monitoring">
                          <Radio size={14} />
                        </Link>
                        {p.postUrl && (
                          <a href={p.postUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-icon" title="Open post">
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <button type="button" className="btn-ghost btn-icon text-red-400" title="Archive" onClick={() => void archive(p.id)}>
                          <AlertTriangle size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-2xs text-gray-500 border-t border-bg-border">
            {filtered.length} post{filtered.length === 1 ? '' : 's'} · Updated {format(new Date(), 'MMM d, h:mm a')}
          </div>
        </div>
      )}
    </div>
  );
}
