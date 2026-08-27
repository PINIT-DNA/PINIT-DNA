/**
 * Client → Assets and Client → People.
 *
 * The last two rollups, built the same way as the other four: the campaign
 * service answered across the client's campaigns, merged here. Neither reads
 * Asset or any membership table directly, so there is no second asset store and
 * no second people system.
 *
 * Both keep the same distinction the campaign views keep — an asset that was
 * delivered but whose link no longer opens is not the same as one that was
 * never delivered, and a creator whose access was revoked is not the same as
 * one who still has it. Flattening either would make the summary reassuring
 * where it should not be.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive, Users, AlertTriangle, RefreshCw, ShieldCheck, ShieldAlert,
  Inbox, Truck, CheckCircle2, ChevronRight, Clock, Link2, Lock,
} from 'lucide-react';
import { getClientAssets, getClientPeople } from '../../../services/business.api';
import type { ClientAssets, ClientPeople } from '../../../services/business.api';
import { SectionCard, SkeletonRows } from './BusinessKit';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const ago = (iso: string) => {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/** Same loader the other four rollups use — one behaviour for all six tabs. */
function useRollup<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const run = useCallback(async () => {
    setError(null); setForbidden(false);
    try {
      setData(await load());
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // 403 is a different thing from a failure and deserves different words.
      if (status === 403) setForbidden(true);
      else setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (err instanceof Error ? err.message : 'Could not load this'),
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void run(); }, [run]);
  return { data, loading, error, forbidden, reload: run };
}

function Forbidden({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
      <Lock size={20} className="text-gray-500 mx-auto mb-2" />
      <p className="text-sm font-semibold text-white mb-1">You don't have access to {what}</p>
      <p className="text-xs text-gray-400">Ask an owner or manager if you need it.</p>
    </div>
  );
}

function Failed({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
      <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
      <p className="text-sm font-semibold text-white mb-1">Couldn't load {what}</p>
      <p className="text-xs text-gray-400 mb-3">{error}</p>
      <button type="button" onClick={onRetry}
        className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
        <RefreshCw size={13} /> Try again
      </button>
    </div>
  );
}

function PartialNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="text-2xs text-amber-400 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 mb-3">
      One of this client's campaigns could not be read, so these totals are incomplete.
    </p>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-card px-2.5 py-2">
      <p className={cn('text-base font-semibold', tone ?? 'text-white')}>{value}</p>
      <p className="text-2xs text-gray-500">{label}</p>
    </div>
  );
}

// ── Assets ──────────────────────────────────────────────────────────────────

const REVIEW_TONE: Record<string, string> = {
  APPROVED: 'text-emerald-400',
  IN_REVIEW: 'text-dna-400',
  CHANGES_REQUESTED: 'text-amber-400',
  DRAFT: 'text-gray-500',
};

export function ClientAssetsPanel({ clientId }: { clientId: string }) {
  const navigate = useNavigate();
  const { data, loading, error, forbidden, reload } =
    useRollup<ClientAssets>(() => getClientAssets(clientId), [clientId]);
  const [campaignFilter, setFilter] = useState<string | null>(null);

  if (loading) return <SkeletonRows rows={4} />;
  if (forbidden) return <SectionCard title="Assets" icon={Archive}>
    <Forbidden what="this client's assets" /></SectionCard>;
  if (error) return <SectionCard title="Assets" icon={Archive}>
    <Failed what="assets" error={error} onRetry={reload} /></SectionCard>;
  if (!data) return null;

  const shown = campaignFilter
    ? data.assets.filter((a) => a.campaign.id === campaignFilter)
    : data.assets;

  return (
    <SectionCard title={`Assets (${data.counts.total})`} icon={Archive}>
      <PartialNote show={data.partial} />

      {data.assets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
          <Inbox size={20} className="text-gray-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">No assets yet</p>
          <p className="text-xs text-gray-400 max-w-md mx-auto">
            {data.campaignCount === 0
              ? 'This client has no campaigns yet.'
              : "Assets appear here once they're added to one of this client's campaigns."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Stat label="Assets" value={data.counts.total} />
            <Stat label="Fully protected" value={data.counts.fullyProtected}
              tone={data.counts.fullyProtected === data.counts.total
                ? 'text-emerald-400' : 'text-amber-400'} />
            <Stat label="Approved" value={data.counts.approved} />
            <Stat label="Delivered" value={data.counts.delivered} />
          </div>

          {/* Filter by campaign — the grouping people actually think in. */}
          {data.byCampaign.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <button type="button" onClick={() => setFilter(null)}
                aria-pressed={campaignFilter === null}
                className={cn('px-2.5 py-1 rounded-lg text-2xs font-semibold border transition-colors',
                  campaignFilter === null
                    ? 'bg-dna-500 text-white border-dna-600'
                    : 'text-gray-400 bg-bg-card border-bg-border hover:text-white')}>
                All {data.counts.total}
              </button>
              {data.byCampaign.map((c) => (
                <button key={c.id} type="button" onClick={() => setFilter(c.id)}
                  aria-pressed={campaignFilter === c.id}
                  className={cn('px-2.5 py-1 rounded-lg text-2xs font-semibold border transition-colors',
                    campaignFilter === c.id
                      ? 'bg-dna-500 text-white border-dna-600'
                      : 'text-gray-400 bg-bg-card border-bg-border hover:text-white')}>
                  {c.name} {c.count}
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <p className="text-xs text-gray-500 px-1 py-4 text-center">
              No assets in that campaign.
            </p>
          ) : (
            <ul className="space-y-2">
              {shown.map((a) => (
                <li key={a.assetId}>
                  <button type="button" onClick={() => navigate(a.deepLink)}
                    className="w-full text-left rounded-xl border border-bg-border bg-bg-card p-3
                               hover:border-dna-500/40 transition-colors group">
                    <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{a.filename}</p>
                        <p className="text-2xs text-gray-500">{a.campaign.name}</p>
                      </div>
                      <ChevronRight size={14}
                        className="text-gray-600 group-hover:text-dna-400 shrink-0 transition-colors" />
                    </div>

                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-2xs">
                      {/* Protection, stated as a fact rather than a badge colour. */}
                      <span className={cn('inline-flex items-center gap-1',
                        a.protection.complete ? 'text-emerald-400' : 'text-amber-400')}>
                        {a.protection.complete
                          ? <><ShieldCheck size={10} /> fully protected</>
                          : <><ShieldAlert size={10} /> {[
                              a.protection.hasDna && 'fingerprinted',
                              a.protection.hasVault && 'vaulted',
                              a.protection.hasCertificate && 'certified',
                            ].filter(Boolean).join(', ') || 'not protected'}</>}
                      </span>

                      {a.review.currentVersion !== null && (
                        <span className="text-gray-500">
                          V{a.review.currentVersion}
                          {a.review.versionCount > 1 && ` of ${a.review.versionCount}`}
                        </span>
                      )}

                      {a.review.reviewStatus && (
                        <span className={cn('font-semibold',
                          REVIEW_TONE[a.review.reviewStatus] ?? 'text-gray-500')}>
                          {a.review.reviewStatus.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      )}

                      {a.handover.delivered && (
                        <span className={cn('inline-flex items-center gap-1',
                          a.handover.accessLive ? 'text-emerald-400' : 'text-gray-500')}>
                          <Truck size={10} />
                          {a.handover.accessLive ? 'delivered' : 'delivered — link closed'}
                        </span>
                      )}

                      {a.rightsState !== 'NONE' && a.rightsState !== 'UNKNOWN' && (
                        <span className="text-gray-500">{a.rightsState.toLowerCase()}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ── People ──────────────────────────────────────────────────────────────────

export function ClientPeoplePanel({ clientId }: { clientId: string }) {
  const navigate = useNavigate();
  const { data, loading, error, forbidden, reload } =
    useRollup<ClientPeople>(() => getClientPeople(clientId), [clientId]);

  if (loading) return <SkeletonRows rows={3} />;
  if (forbidden) return <SectionCard title="People" icon={Users}>
    <Forbidden what="this client's people" /></SectionCard>;
  if (error) return <SectionCard title="People" icon={Users}>
    <Failed what="people" error={error} onRetry={reload} /></SectionCard>;
  if (!data) return null;

  return (
    <SectionCard title={`People (${data.counts.total})`} icon={Users}>
      <PartialNote show={data.partial} />

      {data.clientContact?.contactName && (
        <div className="rounded-lg border border-bg-border bg-bg-elevated/40 px-2.5 py-2 mb-3">
          <p className="text-2xs font-semibold text-gray-400 mb-0.5">Client contact</p>
          <p className="text-xs text-gray-200">{data.clientContact.contactName}</p>
          {data.clientContact.contactEmail && (
            <p className="text-2xs text-gray-500">{data.clientContact.contactEmail}</p>
          )}
        </div>
      )}

      {data.people.length === 0 ? (
        <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
          <Users size={20} className="text-gray-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Nobody assigned yet</p>
          <p className="text-xs text-gray-400 max-w-md mx-auto">
            {data.campaignCount === 0
              ? 'This client has no campaigns yet.'
              : "People appear here once they're added to one of this client's campaigns."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="People" value={data.counts.total} />
            <Stat label="Team" value={data.counts.internal} />
            <Stat label="External" value={data.counts.external}
              tone={data.counts.external > 0 ? 'text-dna-400' : undefined} />
          </div>

          <ul className="space-y-2">
            {data.people.map((p) => (
              <li key={p.key} className="rounded-xl border border-bg-border bg-bg-card p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{p.name}</p>
                    <p className="text-2xs text-gray-500">
                      {p.kind === 'internal'
                        ? (p.orgRole ? p.orgRole.toLowerCase() : 'team member')
                        : p.roleLabels.join(', ') || 'external creator'}
                      {p.shortId && ` · ${p.shortId}`}
                    </p>
                  </div>
                  <span className={cn(
                    'text-2xs font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap',
                    p.kind === 'internal'
                      ? 'text-gray-300 bg-bg-elevated border-bg-border'
                      : p.hasLiveAccess
                        ? 'text-dna-400 bg-dna-500/10 border-dna-500/30'
                        : 'text-gray-500 bg-bg-elevated border-bg-border',
                  )}>
                    {p.kind === 'internal' ? 'Team'
                      : p.hasLiveAccess ? 'External · active' : 'External · no access'}
                  </span>
                </div>

                {/* Which campaigns, and on external rows what access each carries. */}
                <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                  {p.campaigns.map((c) => (
                    <button key={c.id} type="button"
                      onClick={() => navigate(`/business/campaigns/${c.id}?tab=people`)}
                      className="text-2xs rounded-lg border border-bg-border bg-bg-elevated
                                 px-2 py-0.5 text-gray-400 hover:text-white hover:border-dna-500/30
                                 transition-colors">
                      {c.name}
                      {p.kind === 'external' && c.accessStatus !== 'ACTIVE' && (
                        <span className="text-gray-600"> · {c.accessStatus.toLowerCase()}</span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-2xs text-gray-500">
                  <span>{p.campaignCount} campaign{p.campaignCount === 1 ? '' : 's'}</span>
                  {p.assetCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Link2 size={10} /> {p.assetCount} asset{p.assetCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {p.lastAccessAt ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={10} /> last opened {ago(p.lastAccessAt)}
                    </span>
                  ) : p.kind === 'external' && (
                    <span>never opened</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 size={10} /> since {new Date(p.addedAt).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}
