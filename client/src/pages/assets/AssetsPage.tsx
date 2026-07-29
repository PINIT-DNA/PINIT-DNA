/**
 * Universal Assets dashboard — Asset-first protection view.
 * Additive — does not replace Protected Posts.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Package, RefreshCw, Search, Shield } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../../config/api.config';
import { api } from '../../services/dashboard.api';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { cn } from '../../components/ui/utils';

interface AssetRow {
  id: string;
  assetType: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  sourcePlatform: string | null;
  monitorStatus: string;
  discoveriesCount: number;
  riskSeverity: string;
  vaultId: string | null;
  dnaId: string | null;
  certificateId: string | null;
  createdAt: string;
  _count?: { discoveries: number; protectedPosts: number; timeline: number };
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'muted'> = {
  DRAFT: 'muted',
  PROTECTED: 'success',
  MONITORING: 'success',
  DISCOVERY: 'warning',
  INVESTIGATING: 'warning',
  RESOLVED: 'muted',
  ARCHIVED: 'muted',
  FAILED: 'danger',
};

export function AssetsPage() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [assetType, setAssetType] = useState('ALL');
  const [stats, setStats] = useState<{
    totalAssets: number;
    monitoringRunning: number;
    totalDiscoveries: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (assetType !== 'ALL') params.set('assetType', assetType);
      const [listRes, statsRes] = await Promise.all([
        api.get<{ assets: AssetRow[] }>(`${API_BASE_URL}/assets?${params}`),
        api.get<{ stats: NonNullable<typeof stats> }>(`${API_BASE_URL}/assets/stats`).catch(() => null),
      ]);
      setAssets(listRes.data.assets || []);
      if (statsRes?.data?.stats) setStats(statsRes.data.stats);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load assets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [assetType]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter(
      (a) =>
        a.originalFilename.toLowerCase().includes(needle) ||
        (a.sourcePlatform || '').toLowerCase().includes(needle) ||
        a.assetType.toLowerCase().includes(needle),
    );
  }, [assets, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Package className="h-6 w-6 text-brand-600" />
            Assets
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Asset-first protection — Vault, DNA, Certificate, Monitoring. Protected Posts are one view of an Asset.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/protected-posts"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
          >
            <Shield className="h-4 w-4" /> Protected Posts
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm text-white"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            { label: 'Assets', value: stats.totalAssets },
            { label: 'Monitoring', value: stats.monitoringRunning },
            { label: 'Discoveries', value: stats.totalDiscoveries },
            { label: 'Images', value: stats.byType.IMAGE ?? 0 },
            { label: 'Videos', value: stats.byType.VIDEO ?? 0 },
            { label: 'Documents', value: stats.byType.DOCUMENT ?? 0 },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500">{c.label}</div>
              <div className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search filename or platform"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        <select
          value={assetType}
          onChange={(e) => setAssetType(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          {['ALL', 'IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO', 'OTHER'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No assets yet"
          description="Protect a file from the extension (publish, export, or right-click Protect) to create an Asset."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-900/60">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Asset</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Platform</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Discoveries</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-950">
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  className={cn('cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900')}
                  onClick={() => navigate(`/assets/${a.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{a.originalFilename}</td>
                  <td className="px-4 py-3"><Badge variant="info">{a.assetType}</Badge></td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[a.status] || 'muted'}>{a.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{a.sourcePlatform || '—'}</td>
                  <td className="px-4 py-3">{a.discoveriesCount || a._count?.discoveries || 0}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
