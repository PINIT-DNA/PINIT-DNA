/**
 * Asset detail — timeline, discoveries, linked protected posts, monitoring.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Package } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../../config/api.config';
import { api } from '../../services/dashboard.api';
import { Badge } from '../../components/ui/Badge';

interface AssetDetail {
  id: string;
  assetType: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
  vaultId: string | null;
  dnaId: string | null;
  certificateId: string | null;
  monitorRecordId: string | null;
  monitorStatus: string;
  sourcePlatform: string | null;
  sourceUrl: string | null;
  capturedVia: string;
  riskScore: number;
  riskSeverity: string;
  discoveriesCount: number;
  fingerprints: unknown;
  createdAt: string;
  timeline: Array<{
    id: string;
    createdAt: string;
    eventType: string;
    title: string;
    detail: string | null;
    url: string | null;
    similarity: number | null;
  }>;
  discoveries: Array<{
    id: string;
    url: string;
    platform: string | null;
    similarity: number;
    severity: string;
    tampered: boolean;
    firstSeen: string;
    lastSeen: string;
  }>;
  protectedPosts: Array<{
    id: string;
    platform: string;
    postUrl: string | null;
    status: string;
    monitorStatus: string;
  }>;
}

export function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<{ asset: AssetDetail }>(`${API_BASE_URL}/assets/${id}`);
        setAsset(res.data.asset);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load asset');
        navigate('/assets');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  if (loading || !asset) {
    return <div className="p-8 text-sm text-gray-500">Loading asset…</div>;
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate('/assets')}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Assets
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Package className="h-6 w-6 text-brand-600" />
            {asset.originalFilename}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {asset.assetType} · {asset.mimeType} · {(asset.sizeBytes / 1024).toFixed(1)} KB · via {asset.capturedVia}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="info">{asset.assetType}</Badge>
          <Badge variant="success">{asset.status}</Badge>
          <Badge variant="warning">{asset.riskSeverity}</Badge>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Vault', value: asset.vaultId?.slice(0, 8) || '—' },
          { label: 'DNA', value: asset.dnaId?.slice(0, 8) || '—' },
          { label: 'Certificate', value: asset.certificateId?.slice(0, 12) || '—' },
          { label: 'Monitor', value: asset.monitorStatus },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xs uppercase text-gray-500">{c.label}</div>
            <div className="mt-1 font-mono text-sm text-gray-900 dark:text-white">{c.value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Linked Protected Posts</h2>
        {asset.protectedPosts.length === 0 ? (
          <p className="text-sm text-gray-500">No linked posts yet.</p>
        ) : (
          <ul className="space-y-2">
            {asset.protectedPosts.map((p) => (
              <li key={p.id}>
                <Link to={`/protected-posts/${p.id}`} className="text-sm text-brand-600 hover:underline">
                  {p.platform} · {p.status} · {p.postUrl || p.id.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Discoveries</h2>
        {asset.discoveries.length === 0 ? (
          <p className="text-sm text-gray-500">No discoveries yet.</p>
        ) : (
          <ul className="space-y-3">
            {asset.discoveries.map((d) => (
              <li key={d.id} className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={d.tampered ? 'danger' : 'warning'}>{d.severity}</Badge>
                  <span className="text-sm text-gray-700 dark:text-gray-200">{d.platform || 'web'}</span>
                  <span className="text-xs text-gray-500">{Math.round(d.similarity * 100)}% similar</span>
                </div>
                <a href={d.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm text-brand-600">
                  {d.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Timeline</h2>
        <ul className="space-y-3">
          {asset.timeline.map((e) => (
            <li key={e.id} className="border-l-2 border-brand-500 pl-3">
              <div className="text-xs text-gray-500">{format(new Date(e.createdAt), 'PPpp')}</div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">{e.title}</div>
              {e.detail && <div className="text-xs text-gray-500">{e.detail}</div>}
            </li>
          ))}
        </ul>
      </section>

      {asset.fingerprints != null && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Fingerprints</h2>
          <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-950">
            {JSON.stringify(asset.fingerprints, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
