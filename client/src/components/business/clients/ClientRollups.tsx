/**
 * Client-level rollups — Deliveries, Rights, Activity and Intelligence.
 *
 * These replace four placeholders. Each shows the campaign-level answer summed
 * across the client's campaigns, and each keeps two distinctions the campaign
 * views also keep, because losing them in a summary is how a rollup starts
 * lying:
 *
 *   - "nothing found" is not "nothing looked for". The Intelligence panel
 *     carries the discovery capability up unchanged, so a findings total of zero
 *     is read correctly.
 *
 *   - "no rights recorded" is not "we could not reach Exchange". The Rights
 *     panel says which it is.
 *
 * A `partial` flag appears when one campaign could not be read: the other
 * campaigns still show, and the totals are marked incomplete rather than being
 * presented as the whole picture.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Truck, ScrollText, Activity, Sparkles, AlertTriangle, RefreshCw,
  Inbox, ShieldCheck, ShieldQuestion, Clock,
} from 'lucide-react';
import {
  getClientDeliveries, getClientRights, getClientActivity, getClientIntelligence,
} from '../../../services/business.api';
import type {
  ClientDeliveries, ClientRights, ClientActivity, ClientIntelligence,
} from '../../../services/business.api';
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

/** One loader for all four panels — same loading, error and empty behaviour. */
function useRollup<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    try {
      setData(await load());
    } catch (err) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (err instanceof Error ? err.message : 'Could not load this'),
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void run(); }, [run]);
  return { data, loading, error, reload: run };
}

function Failed({ title, error, onRetry }: { title: string; error: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
      <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
      <p className="text-sm font-semibold text-white mb-1">Couldn't load {title}</p>
      <p className="text-xs text-gray-400 mb-3">{error}</p>
      <button type="button" onClick={onRetry}
        className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
        <RefreshCw size={13} /> Try again
      </button>
    </div>
  );
}

function Empty({ icon: Icon, title, detail }: {
  icon: typeof Inbox; title: string; detail: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
      <Icon size={20} className="text-gray-500 mx-auto mb-2" />
      <p className="text-sm font-semibold text-white mb-1">{title}</p>
      <p className="text-xs text-gray-400 max-w-md mx-auto">{detail}</p>
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

// ── Deliveries ──────────────────────────────────────────────────────────────

export function ClientDeliveriesPanel({ clientId }: { clientId: string }) {
  const { data, loading, error, reload } =
    useRollup<ClientDeliveries>(() => getClientDeliveries(clientId), [clientId]);

  if (loading) return <SkeletonRows rows={3} />;
  if (error) return <SectionCard title="Deliveries" icon={Truck}>
    <Failed title="deliveries" error={error} onRetry={reload} /></SectionCard>;
  if (!data) return null;

  return (
    <SectionCard title="Deliveries" icon={Truck}>
      <PartialNote show={data.partial} />

      {data.deliveries.length === 0 ? (
        <Empty icon={Inbox} title="Nothing handed over yet"
          detail={data.campaignCount === 0
            ? 'This client has no campaigns yet.'
            : 'A delivery appears here when a campaign hands approved work to this client.'} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Stat label="Handovers" value={data.counts.total} />
            <Stat label="Live" value={data.counts.live} tone="text-emerald-400" />
            <Stat label="Opened" value={data.counts.opened} />
            <Stat label="Assets" value={data.counts.assetsDelivered} />
          </div>

          <ul className="space-y-2">
            {data.deliveries.map((d) => {
              const live = !d.revokedAt && (!d.expiresAt || new Date(d.expiresAt) > new Date());
              return (
                <li key={d.id} className={cn(
                  'rounded-xl border bg-bg-card p-3',
                  live ? 'border-bg-border' : 'border-bg-border opacity-80',
                )}>
                  <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {d.title ?? `Handover to ${d.recipientLabel}`}
                      </p>
                      <p className="text-2xs text-gray-500">{d.campaign.name}</p>
                    </div>
                    <span className={cn(
                      'text-2xs font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap',
                      d.revokedAt ? 'text-gray-500 bg-bg-elevated border-bg-border'
                        : live ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                        : 'text-amber-400 bg-amber-500/10 border-amber-500/30',
                    )}>
                      {d.revokedAt ? 'Revoked' : live ? d.status : 'Expired'}
                    </span>
                  </div>
                  <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-2xs text-gray-500">
                    <span>{d.assets.length} asset{d.assets.length === 1 ? '' : 's'}</span>
                    {d.sentAt && <span>Sent {ago(d.sentAt)}</span>}
                    {d.openCount > 0
                      ? <span className="text-emerald-400">Opened {d.openCount}×</span>
                      : d.sentAt && <span>Not opened yet</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

// ── Rights ──────────────────────────────────────────────────────────────────

const STATE_TONE: Record<string, string> = {
  ACTIVE: 'text-emerald-400',
  AVAILABLE: 'text-dna-400',
  EXPIRING: 'text-amber-400',
  EXPIRED: 'text-rose-400',
  RESTRICTED: 'text-amber-400',
  NONE: 'text-gray-500',
  UNKNOWN: 'text-gray-500',
};

export function ClientRightsPanel({ clientId }: { clientId: string }) {
  const { data, loading, error, reload } =
    useRollup<ClientRights>(() => getClientRights(clientId), [clientId]);

  if (loading) return <SkeletonRows rows={3} />;
  if (error) return <SectionCard title="Usage rights" icon={ScrollText}>
    <Failed title="rights" error={error} onRetry={reload} /></SectionCard>;
  if (!data) return null;

  return (
    <SectionCard title="Usage rights" icon={ScrollText}>
      <PartialNote show={data.partial} />

      {/* An outage and an empty answer look identical unless you say which. */}
      {!data.exchangeReachable && (
        <p className="text-2xs text-amber-400 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 mb-3">
          The Exchange could not be reached, so licence state below may be incomplete.
          This is not the same as no rights being recorded.
        </p>
      )}

      {data.assets.length === 0 ? (
        <Empty icon={ScrollText} title="No assets to show rights for"
          detail={data.campaignCount === 0
            ? 'This client has no campaigns yet.'
            : "Rights appear once this client's campaigns contain protected assets."} />
      ) : (
        <>
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {Object.entries(data.counts.byState).map(([state, n]) => (
              <span key={state} className="text-2xs rounded-lg border border-bg-border bg-bg-card px-2 py-1">
                <span className={cn('font-semibold', STATE_TONE[state] ?? 'text-gray-400')}>{n}</span>
                <span className="text-gray-500 ml-1">{state.toLowerCase()}</span>
              </span>
            ))}
          </div>

          <ul className="space-y-1.5">
            {data.assets.map((a) => (
              <li key={a.assetId}
                className="rounded-lg border border-bg-border bg-bg-card px-2.5 py-2 flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{a.filename}</p>
                  <p className="text-2xs text-gray-500">{a.campaign.name}</p>
                </div>
                <span className={cn('text-2xs font-semibold whitespace-nowrap',
                  STATE_TONE[a.rightsState ?? 'UNKNOWN'] ?? 'text-gray-500')}>
                  {(a.rightsState ?? 'Not listed').toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

// ── Activity ────────────────────────────────────────────────────────────────

export function ClientActivityPanel({ clientId }: { clientId: string }) {
  const { data, loading, error, reload } =
    useRollup<ClientActivity>(() => getClientActivity(clientId), [clientId]);

  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <SectionCard title="Activity" icon={Activity}>
    <Failed title="activity" error={error} onRetry={reload} /></SectionCard>;
  if (!data) return null;

  return (
    <SectionCard title="Activity" icon={Activity}>
      {data.entries.length === 0 ? (
        <Empty icon={Clock} title="Nothing has happened yet"
          detail={data.campaignCount === 0
            ? 'This client has no campaigns yet.'
            : "Actions across this client's campaigns appear here as they happen."} />
      ) : (
        <ol className="space-y-1.5">
          {data.entries.map((e) => (
            <li key={e.id} className="rounded-lg border border-bg-border bg-bg-card px-2.5 py-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <p className="text-xs text-gray-200 min-w-0">{e.title}</p>
                <span className="text-2xs text-gray-600 whitespace-nowrap">{ago(e.at)}</span>
              </div>
              <p className="text-2xs text-gray-500 mt-0.5">
                {e.actor}
                {e.campaignName && <> · {e.campaignName}</>}
              </p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

// ── Intelligence ────────────────────────────────────────────────────────────

export function ClientIntelligencePanel({ clientId }: { clientId: string }) {
  const { data, loading, error, reload } =
    useRollup<ClientIntelligence>(() => getClientIntelligence(clientId), [clientId]);

  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <SectionCard title="Intelligence" icon={Sparkles}>
    <Failed title="intelligence" error={error} onRetry={reload} /></SectionCard>;
  if (!data) return null;

  const t = data.totals;
  const operational = data.discovery?.anyProviderOperational === true;

  return (
    <div className="space-y-4">
      <SectionCard title="Intelligence" icon={Sparkles}>
        <PartialNote show={data.partial} />

        {data.campaignCount === 0 ? (
          <Empty icon={Sparkles} title="Nothing to summarise yet"
            detail="This client has no campaigns yet." />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <Stat label="Assets" value={t.assets} />
              <Stat label="Fingerprinted" value={t.withDna} />
              <Stat label="Certified" value={t.withCertificate} />
              <Stat label="Monitored" value={t.monitored} />
            </div>

            {/* The caveat has to survive the rollup, or the zero misleads. */}
            {data.discovery && !operational && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 mb-3">
                <p className="text-2xs font-semibold text-amber-400 inline-flex items-center gap-1.5">
                  <ShieldQuestion size={11} />
                  {data.discovery.crawlerEnabled
                    ? 'External discovery is not producing results'
                    : 'External discovery is not running'}
                </p>
                <p className="text-2xs text-gray-400 mt-0.5">{data.discovery.summary}</p>
                <p className="text-2xs text-gray-500 mt-1">
                  Read the findings figure with that in mind: nothing found is not the
                  same as nothing out there.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              <Stat label="Findings" value={t.findings}
                tone={t.findings > 0 ? 'text-amber-400' : undefined} />
              <Stat label="Confirmed" value={t.findingsConfirmed}
                tone={t.findingsConfirmed > 0 ? 'text-rose-400' : undefined} />
              <Stat label="Needs review" value={t.findingsNeedsReview} />
            </div>

            <p className="text-2xs font-semibold text-gray-400 mb-1.5">By campaign</p>
            <ul className="space-y-1.5">
              {data.campaigns.map((c) => (
                <li key={c.id}
                  className="rounded-lg border border-bg-border bg-bg-card px-2.5 py-2 flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-white min-w-0 truncate">{c.name}</p>
                  <span className="text-2xs text-gray-500 whitespace-nowrap">
                    {c.assets} asset{c.assets === 1 ? '' : 's'} · {c.monitored} monitored
                    {c.findings > 0 && (
                      <span className="text-amber-400"> · {c.findings} finding
                        {c.findings === 1 ? '' : 's'}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {operational && t.findings === 0 && (
              <p className="text-2xs text-gray-500 mt-3 inline-flex items-center gap-1.5">
                <ShieldCheck size={11} className="text-emerald-500" />
                Discovery is working and has found nothing copied.
              </p>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}
