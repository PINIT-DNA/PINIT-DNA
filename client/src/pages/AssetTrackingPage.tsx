/**
 * One asset, everything that happened to it.
 *
 * Every copy of this asset sits in one list — the six people you sent Ocean.jpg to,
 * with anyone they forwarded it to nested underneath, and the buyer's delivery link
 * from an Exchange sale in the same place. Opening a row goes to the existing link
 * screen, which is unchanged.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { ArrowLeft, BadgeCheck, ShoppingBag, Globe, Radar, FileSearch, CornerDownRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAssetTracking, groupSharesByThread, type AssetTracking, type TrackedShare } from '../services/tracking.api';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';

type Tab = 'shares' | 'certificate' | 'exchange' | 'elsewhere';

function Tile({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof BadgeCheck;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3.5 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        <Icon size={12} aria-hidden /> {label}
      </div>
      <div className="mt-1 font-mono text-xl tabular-nums text-gray-900 dark:text-white">{value}</div>
      <div className="text-xs text-gray-500">{detail}</div>
    </div>
  );
}

function ShareRow({ share, child = false }: { share: TrackedShare; child?: boolean }) {
  const navigate = useNavigate();
  const state = !share.isActive
    ? { label: 'Stopped', variant: 'muted' as const }
    : share.expiresAt && new Date(share.expiresAt) < new Date()
      ? { label: 'Expired', variant: 'muted' as const }
      : { label: 'Live', variant: 'success' as const };

  const who = child
    ? `Forwarded by ${share.forwardedByLabel || 'a recipient'}`
    : share.recipient || (share.fromExchange ? 'Buyer delivery' : 'Anyone with the link');

  return (
    <button
      type="button"
      onClick={() => navigate(`/access-intelligence/${encodeURIComponent(share.token)}`)}
      className={`flex w-full flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-left hover:bg-brand-50 dark:border-gray-800 dark:hover:bg-gray-800 ${
        child ? 'bg-brand-50/40 pl-10 dark:bg-gray-800/40' : ''
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
          {child && <CornerDownRight size={13} className="text-brand-600" aria-hidden />}
          <span className="truncate">{who}</span>
          {share.fromExchange && !child && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              From a sale
            </span>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-gray-500">
          sent {format(new Date(share.createdAt), 'd MMM')}
          {share.lastSeenAt ? ` · last opened ${formatDistanceToNow(new Date(share.lastSeenAt), { addSuffix: true })}` : ' · never opened'}
          {share.country ? ` · ${share.country}` : ''}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={state.variant}>{state.label}</Badge>
        <span className="rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          <b className="font-mono tabular-nums">{share.views}</b> views
        </span>
        {share.downloads > 0 && (
          <span className="rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <b className="font-mono tabular-nums">{share.downloads}</b> downloads
          </span>
        )}
        {share.screenshotAttempts > 0 && (
          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <b className="font-mono tabular-nums">{share.screenshotAttempts}</b> screenshots
          </span>
        )}
      </div>
    </button>
  );
}

export function AssetTrackingPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AssetTracking | null>(null);
  const [tab, setTab] = useState<Tab>('shares');

  useEffect(() => {
    if (!assetId) return;
    getAssetTracking(assetId)
      .then(setData)
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Could not load this asset');
        navigate('/tracking');
      });
  }, [assetId, navigate]);

  if (!data) return <SkeletonCard />;

  const { asset, certificate, shares, purchases, portfolio, monitoring, evidence } = data;
  const threads = groupSharesByThread(shares);
  const totalViews = shares.reduce((sum, s) => sum + s.views, 0);
  const reshareCount = shares.filter((s) => s.parentLinkId).length;

  const tabs: Array<[Tab, string]> = [
    ['shares', `Shares · ${threads.length}`],
    ['certificate', 'Certificate'],
    ['exchange', `Exchange · ${purchases.length}`],
    ['elsewhere', 'Portfolio & monitoring'],
  ];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate('/tracking')}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-4 w-4" /> All tracking
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-gray-900 dark:text-white">{asset.filename}</h1>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Badge variant="success">{asset.status}</Badge>
            <Badge variant="info">{asset.assetType}</Badge>
            {certificate && (
              <Badge variant={certificate.status === 'ACTIVE' ? 'success' : 'warning'}>
                Certificate {certificate.status.toLowerCase()}
              </Badge>
            )}
            {purchases.length > 0 && <Badge variant="warning">Sold on Exchange</Badge>}
          </div>
          {certificate && (
            <p className="mt-2 truncate font-mono text-[11px] text-gray-500">{certificate.certificateId}</p>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile icon={FileSearch} label="Shares" value={String(threads.length)}
          detail={`${totalViews} views · ${reshareCount} reshares`} />
        <Tile icon={BadgeCheck} label="Certificate" value={certificate?.checks === null ? '—' : String(certificate?.checks ?? 0)}
          detail={certificate?.lastCheckedAt
            ? `last ${format(new Date(certificate.lastCheckedAt), 'd MMM')}`
            : certificate ? 'not checked yet' : 'none issued'} />
        <Tile icon={Globe} label="Portfolio" value={portfolio.shown ? 'Shown' : 'No'}
          detail={portfolio.views === null ? 'views unavailable' : `${portfolio.views} portfolio views`} />
        <Tile icon={ShoppingBag} label="Exchange" value={String(purchases.length)}
          detail={purchases.length ? 'purchases' : 'not sold yet'} />
        <Tile icon={Radar} label="Found online" value={String(monitoring.foundOnline)}
          detail={`monitoring ${monitoring.status.toLowerCase()}`} />
      </div>

      {data.unavailable.length > 0 && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
          Not counted right now: {data.unavailable.join(', ')}. Shown as “—” rather than zero.
        </p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm ${
              tab === key
                ? 'border-brand-600 font-semibold text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'shares' && (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-2.5 text-sm font-semibold dark:bg-gray-800">
            <span>Everyone this asset was sent to</span>
            <span className="font-mono text-xs font-normal text-gray-500">{shares.length} links</span>
          </div>
          {threads.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">This asset has not been shared yet.</p>
          ) : (
            threads.map(({ share, reshares }) => (
              <div key={share.shareLinkId}>
                <ShareRow share={share} />
                {reshares.map((r) => (
                  <ShareRow key={r.shareLinkId} share={r} child />
                ))}
              </div>
            ))
          )}
        </section>
      )}

      {tab === 'certificate' && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          {certificate ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-gray-500">Certificate ID</dt>
                  <dd className="mt-0.5 break-all font-mono text-xs">{certificate.certificateId}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-gray-500">Status</dt>
                  <dd className="mt-0.5 text-sm">
                    {certificate.status} · issued {format(new Date(certificate.issuedAt), 'd MMM yyyy')}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-gray-500">Checks</dt>
                  <dd className="mt-0.5 text-sm">
                    {certificate.checks === null ? 'Not counted yet' : `${certificate.checks} times`}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-gray-500">Last checked</dt>
                  <dd className="mt-0.5 text-sm">
                    {certificate.lastCheckedAt ? format(new Date(certificate.lastCheckedAt), 'PPp') : '—'}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-gray-500">
                Anyone holding the link can check this certificate without an account. Who checked it is
                never recorded, so this counts checks and nothing more.
              </p>
              <Link
                to={`/verify-certificate?id=${encodeURIComponent(certificate.certificateId)}`}
                className="mt-3 inline-flex text-sm text-brand-600 hover:underline"
              >
                Open verification
              </Link>
            </>
          ) : (
            <p className="text-sm text-gray-500">No certificate has been issued for this asset.</p>
          )}
        </section>
      )}

      {tab === 'exchange' && (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {purchases.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">This asset has not been sold on Exchange.</p>
          ) : (
            purchases.map((p) => (
              <div key={p.sealId ?? p.orderId} className="border-t border-gray-100 px-4 py-3 first:border-t-0 dark:border-gray-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {p.licenseTier ? `${p.licenseTier} licence` : 'Licence'} · {p.buyerPinitId ?? 'buyer'}
                  </span>
                  <Badge variant={(p.licenseStatus ?? '').toLowerCase() === 'active' ? 'success' : 'muted'}>
                    {p.licenseStatus ?? 'unknown'}
                  </Badge>
                </div>
                <div className="mt-1 font-mono text-[11px] text-gray-500">
                  {p.orderId ?? '—'} · sealed {p.sealedAt ? format(new Date(p.sealedAt), 'd MMM yyyy') : '—'}
                  {p.deliveryExpiresAt ? ` · delivery expires ${format(new Date(p.deliveryExpiresAt), 'd MMM')}` : ''}
                </div>
              </div>
            ))
          )}
          <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-gray-800">
            The buyer’s delivery link is tracked with the other shares. Earnings and payment references
            stay in Exchange — this page is about where the file went.
          </p>
        </section>
      )}

      {tab === 'elsewhere' && (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-sm font-semibold">Portfolio</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {portfolio.shown ? 'Shown on your public portfolio.' : 'Not on your portfolio.'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {portfolio.views === null
                ? 'Portfolio views are not counted yet.'
                : `${portfolio.views} portfolio page views — counted for the whole portfolio, once per day, with no viewer identity.`}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-sm font-semibold">Monitoring and evidence</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {monitoring.foundOnline > 0
                ? `${monitoring.foundOnline} copies found online.`
                : 'Nothing found online so far.'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Monitoring {monitoring.status.toLowerCase()} · {evidence.records} evidence records ·{' '}
              {evidence.investigations} investigations
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
