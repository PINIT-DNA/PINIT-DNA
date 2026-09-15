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
  campaign: {
    id: string;
    name: string;
    status: string;
    client: { id: string; name: string } | null;
    organization: { id: string; name: string } | null;
  } | null;
  ownerUser: { id: string; fullName: string | null; shortId: string | null } | null;
  versions: Array<{
    id: string;
    versionNumber: number;
    originalFilename: string;
    createdAt: string;
    certificateId: string | null;
  }>;
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

      {/*
        * These four cards showed truncated identifiers — eight characters of a
        * vault UUID, eight of a DNA UUID, twelve of a certificate UUID. None of
        * them meant anything to the person reading the page. They now answer
        * what the asset is, who holds it, what it belongs to and whether it is
        * protected; the identifiers move into the collapsed block below for the
        * cases where someone genuinely needs them.
        */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Identity',
            value: asset.originalFilename,
            sub: asset.dnaId ? 'Asset DNA generated' : 'No DNA on record',
          },
          {
            label: 'Owner',
            value: asset.ownerUser?.fullName || asset.ownerUser?.shortId || 'You',
            sub: asset.capturedVia === 'hub_protect_file' ? 'Protected in Hub' : asset.capturedVia,
          },
          {
            label: 'Belongs to',
            value: asset.campaign?.name || 'Not campaign work',
            sub: asset.campaign?.client?.name
              ? `for ${asset.campaign.client.name}`
              : asset.campaign
                ? asset.campaign.status
                : 'No campaign linked',
          },
          {
            label: 'Protection',
            value: asset.certificateId ? 'Certified' : 'Protected',
            sub: `Monitoring ${asset.monitorStatus.toLowerCase()}`,
          },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xs uppercase text-gray-500">{c.label}</div>
            <div className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white" title={c.value}>
              {c.value}
            </div>
            <div className="mt-0.5 truncate text-xs text-gray-500">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Lineage — only when this asset actually has earlier versions. */}
      {asset.versions.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Lineage</h2>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {asset.versions.map((v) => (
              <li key={v.id} className="flex items-center gap-3 py-2">
                <span className="w-12 shrink-0 text-xs font-semibold text-gray-500">v{v.versionNumber}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-white">
                  {v.originalFilename}
                </span>
                {v.certificateId && <Badge variant="success">Certified</Badge>}
                <span className="shrink-0 text-xs text-gray-500">
                  {new Date(v.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The identifiers, kept for the cases that need them. */}
      <details className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-gray-500">
          Technical identifiers
        </summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            ['Asset', asset.id],
            ['Vault', asset.vaultId],
            ['DNA', asset.dnaId],
            ['Certificate', asset.certificateId],
            ['Content hash', asset.contentHash],
          ]
            .filter(([, v]) => Boolean(v))
            .map(([label, value]) => (
              <div key={String(label)} className="min-w-0">
                <dt className="text-xs uppercase text-gray-500">{label}</dt>
                <dd className="truncate font-mono text-xs text-gray-900 dark:text-white" title={String(value)}>
                  {value}
                </dd>
              </div>
            ))}
        </dl>
      </details>

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
