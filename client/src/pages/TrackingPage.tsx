/**
 * Tracking — one row per asset.
 *
 * The Sharing page lists links, so an asset shared six times appeared six times
 * and its certificate checks appeared nowhere. This lists the asset once and
 * counts each channel separately: Hub shares, certificate checks, portfolio,
 * Exchange purchases, and what monitoring found online.
 *
 * Sharing is untouched and still reachable — some people think in links.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Share2, BadgeCheck, Globe, ShoppingBag, Radar, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { listTrackedAssets, type TrackedAsset } from '../services/tracking.api';
import { SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

type Filter = 'all' | 'shared' | 'sold' | 'attention';

const CHANNELS = [
  { key: 'shares', label: 'Hub shares', icon: Share2, tone: 'text-brand-600 dark:text-brand-400' },
  { key: 'certificate', label: 'Certificate checks', icon: BadgeCheck, tone: 'text-purple dark:text-purple' },
  { key: 'portfolio', label: 'Portfolio', icon: Globe, tone: 'text-sky-600 dark:text-sky-400' },
  { key: 'exchange', label: 'Exchange purchases', icon: ShoppingBag, tone: 'text-amber-600 dark:text-amber-400' },
  { key: 'monitoring', label: 'Found online', icon: Radar, tone: 'text-success' },
] as const;

function Metric({ value, label, warn = false }: { value: number | null; label: string; warn?: boolean }) {
  // A channel the server could not read says so, instead of showing a false zero.
  if (value === null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
        warn
          ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
          : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
      }`}
    >
      <b className="font-mono font-medium tabular-nums">{value}</b>
      {label}
    </span>
  );
}

export function TrackingPage() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<TrackedAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    listTrackedAssets()
      .then(setAssets)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Could not load tracking';
        setError(message);
        toast.error(message);
      });
  }, []);

  const counts = useMemo(() => {
    const list = assets ?? [];
    return {
      all: list.length,
      shared: list.filter((a) => a.channels.shares > 0).length,
      sold: list.filter((a) => (a.channels.purchases ?? 0) > 0).length,
      attention: list.filter((a) => a.channels.screenshotAttempts > 0 || a.channels.foundOnline > 0).length,
    };
  }, [assets]);

  const shown = useMemo(() => {
    const list = assets ?? [];
    if (filter === 'shared') return list.filter((a) => a.channels.shares > 0);
    if (filter === 'sold') return list.filter((a) => (a.channels.purchases ?? 0) > 0);
    if (filter === 'attention') {
      return list.filter((a) => a.channels.screenshotAttempts > 0 || a.channels.foundOnline > 0);
    }
    return list;
  }, [assets, filter]);

  if (error) {
    return <EmptyState icon={AlertTriangle} title="Tracking is unavailable" description={error} />;
  }

  if (!assets) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!assets.length) {
    return (
      <EmptyState
        icon={Radar}
        title="Nothing protected yet"
        description="Protect a file and everything that happens to it — shares, certificate checks, sales — is gathered here."
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* What is counted where. Each channel is separate, so link views never get
          mixed up with certificate checks. */}
      <div className="flex flex-wrap gap-2">
        {CHANNELS.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-300"
          >
            <c.icon size={12} className={c.tone} aria-hidden /> {c.label}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['all', `All ${counts.all}`],
          ['shared', `Shared ${counts.shared}`],
          ['sold', `Sold ${counts.sold}`],
          ['attention', `Needs a look ${counts.attention}`],
        ] as Array<[Filter, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              filter === key
                ? 'bg-brand-600 text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="space-y-2.5">
        {shown.map((a) => {
          const needsLook = a.channels.screenshotAttempts > 0 || a.channels.foundOnline > 0;
          return (
            <li key={a.assetId}>
              <button
                type="button"
                onClick={() => navigate(`/tracking/${a.assetId}`)}
                className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 text-left hover:border-brand-500 dark:bg-gray-900 ${
                  needsLook
                    ? 'border-l-4 border-l-amber-500 border-gray-200 dark:border-gray-800'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-gray-900 dark:text-white">{a.filename}</span>
                    <span className="rounded border border-gray-200 px-1.5 py-0.5 font-mono text-[10px] uppercase text-gray-500 dark:border-gray-700">
                      {a.assetType}
                    </span>
                    {needsLook && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <AlertTriangle size={11} aria-hidden /> Needs a look
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Protected {formatDistanceToNow(new Date(a.protectedAt), { addSuffix: true })}
                    {a.certificateId ? ' · certificate issued' : ' · no certificate'}
                    {a.lastActivityAt
                      ? ` · last activity ${formatDistanceToNow(new Date(a.lastActivityAt), { addSuffix: true })}`
                      : ' · no activity yet'}
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-1.5">
                  <Metric value={a.channels.shares} label="shares" />
                  <Metric value={a.channels.shareViews} label="views" />
                  <Metric value={a.channels.reshares || null} label="reshares" />
                  <Metric value={a.channels.certificateChecks || null} label="checks" />
                  <Metric value={a.channels.purchases || null} label="sold" />
                  <Metric value={a.channels.screenshotAttempts || null} label="screenshots" warn />
                  <Metric value={a.channels.foundOnline || null} label="found online" warn />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
