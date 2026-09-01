/**
 * Campaign → Findings.
 *
 * Reads real discoveries only. There are currently none, and the empty state
 * says why rather than just showing nothing — "nothing found" and "nothing
 * looked for" mean opposite things to someone deciding whether their work is
 * safe, and the difference depends on whether discovery is actually running.
 *
 * A finding is never described as infringement. It is a match with a confidence
 * and a source; what it means is the reviewer's call, and the wording keeps that
 * boundary everywhere.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Search, ExternalLink, AlertTriangle, RefreshCw, Loader2, Check, X,
  ShieldQuestion, Radar, Info, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { listCampaignFindings, decideFinding } from '../../../services/business.api';
import type { CampaignFindings, Finding, FindingStatus } from '../../../services/business.api';
import { SectionCard, SkeletonRows } from '../clients/BusinessKit';
import { timeAgo } from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const STATUS: Record<FindingStatus, { label: string; cls: string }> = {
  PENDING:   { label: 'Needs review', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  CONFIRMED: { label: 'Confirmed',    cls: 'text-rose-400 bg-rose-500/10 border-rose-500/30' },
  DISMISSED: { label: 'Dismissed',    cls: 'text-gray-500 bg-bg-elevated border-bg-border' },
};

/** Match strength, coloured by how much attention it deserves — not by verdict. */
const BAND: Record<string, string> = {
  EXACT_MATCH:    'text-rose-400',
  HIGH_MATCH:     'text-amber-400',
  POSSIBLE_MATCH: 'text-dna-400',
  WEAK:           'text-gray-500',
};

type Tab = 'PENDING' | 'CONFIRMED' | 'DISMISSED' | 'ALL';

export function FindingsPanel({
  campaignId, onChanged, focusFindingId,
}: {
  campaignId: string;
  onChanged?: () => void;
  focusFindingId?: string | null;
}) {
  const [data, setData] = useState<CampaignFindings | null>(null);
  const [tab, setTab] = useState<Tab>(focusFindingId ? 'ALL' : 'PENDING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listCampaignFindings(campaignId, tab === 'ALL' ? undefined : tab));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load findings');
    } finally {
      setLoading(false);
    }
  }, [campaignId, tab]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (f: Finding, status: 'CONFIRMED' | 'DISMISSED') => {
    setBusyId(f.id);
    try {
      await decideFinding(f.id, status);
      toast.success(status === 'CONFIRMED' ? 'Match confirmed' : 'Match dismissed');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not record that');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <SkeletonRows rows={4} />;

  if (error) {
    return (
      <SectionCard title="Findings" icon={Search}>
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
          <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Couldn't load findings</p>
          <p className="text-xs text-gray-400 mb-3">{error}</p>
          <button type="button" onClick={load}
            className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      </SectionCard>
    );
  }

  if (!data) return null;
  const c = data.counts;

  return (
    <div className="space-y-4">
      {c.total > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            ['PENDING', `Needs review ${c.pending}`],
            ['CONFIRMED', `Confirmed ${c.confirmed}`],
            ['DISMISSED', `Dismissed ${c.dismissed}`],
            ['ALL', `All ${c.total}`],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={cn(
                'px-2.5 py-1 rounded-lg text-2xs font-semibold border transition-colors',
                tab === id
                  ? 'bg-dna-500 text-white border-dna-600'
                  : 'text-gray-400 bg-bg-card border-bg-border hover:text-white hover:border-dna-500/30',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <SectionCard title="Findings" icon={Search}>
        {data.findings.length === 0 ? (
          <EmptyState context={data.context} filtered={c.total > 0} tab={tab} />
        ) : (
          <ul className="space-y-2.5">
            {data.findings.map((f) => (
              <FindingRow key={f.id} finding={f} busy={busyId === f.id} focused={f.id === focusFindingId}
                onDecide={(s) => void decide(f, s)} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * The empty state carries the reason.
 *
 * "No findings" is reassuring only if something was actually looking. When
 * nothing is monitored, or discovery is not producing results, saying so is the
 * whole point.
 */
function EmptyState({
  context, filtered, tab,
}: {
  context: { assetsInCampaign: number; assetsMonitored: number };
  filtered: boolean;
  tab: Tab;
}) {
  if (filtered) {
    return (
      <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
        <Search size={20} className="text-gray-500 mx-auto mb-2" />
        <p className="text-sm font-semibold text-white mb-0.5">
          Nothing {tab.toLowerCase()}
        </p>
        <p className="text-xs text-gray-400">Try a different filter.</p>
      </div>
    );
  }

  const nothingMonitored = context.assetsMonitored === 0;

  return (
    <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
      <ShieldQuestion size={20} className="text-gray-500 mx-auto mb-2" />
      <p className="text-sm font-semibold text-white mb-1">No external matches found</p>

      {context.assetsInCampaign === 0 ? (
        <p className="text-xs text-gray-400 max-w-md mx-auto">
          There are no assets in this campaign yet.
        </p>
      ) : nothingMonitored ? (
        <p className="text-xs text-gray-400 max-w-md mx-auto">
          No asset in this campaign is being monitored, so nothing has been looked for.
          Turn monitoring on under the Monitoring tab.
        </p>
      ) : (
        <p className="text-xs text-gray-400 max-w-md mx-auto">
          {context.assetsMonitored} of {context.assetsInCampaign} asset
          {context.assetsInCampaign === 1 ? '' : 's'} monitored, and nothing has matched.
          Check the Monitoring tab for whether discovery is actually producing results —
          an empty list only means your work is unfound if something is genuinely looking.
        </p>
      )}

      <p className="text-2xs text-gray-600 mt-3 inline-flex items-center gap-1.5">
        <Radar size={11} /> Findings appear here automatically when a match is detected.
      </p>
    </div>
  );
}

function FindingRow({
  finding: f, busy, focused, onDecide,
}: {
  finding: Finding; busy: boolean; focused?: boolean; onDecide: (s: 'CONFIRMED' | 'DISMISSED') => void;
}) {
  const s = STATUS[f.status] ?? STATUS.PENDING;
  const settled = f.status !== 'PENDING';
  let host = f.url;
  try { host = new URL(f.url).hostname; } catch { /* keep the raw string */ }

  return (
    <li className={cn(
      'rounded-xl border bg-bg-card p-3',
      focused ? 'border-dna-500/60' : settled ? 'border-bg-border opacity-85' : 'border-amber-500/25',
    )}>
      <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{f.assetName}</p>
          <p className="text-2xs text-gray-500 truncate">
            found on <span className="text-gray-400">{host}</span>
            {f.platform && ` · ${f.platform}`}
          </p>
        </div>
        <span className={cn('text-2xs font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap', s.cls)}>
          {s.label}
        </span>
      </div>

      {/* The signal, described rather than asserted. */}
      <div className="rounded-lg border border-bg-border bg-bg-elevated/40 px-2.5 py-2 mb-2">
        <p className={cn('text-2xs font-semibold', BAND[f.matchBand] ?? 'text-gray-400')}>
          {f.matchLabel} · {(f.similarity * 100).toFixed(0)}% similar
        </p>
        <p className="text-2xs text-gray-500 mt-0.5">{f.matchMeaning}</p>
        {f.tampered && (
          <p className="text-2xs text-amber-400 mt-1">
            Signs of modification detected ({f.tampering.toLowerCase()}).
          </p>
        )}
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-2xs text-gray-500 mb-2">
        <span className="inline-flex items-center gap-1">
          <Clock size={10} /> First seen {timeAgo(f.firstSeen)}
        </span>
        {f.lastSeen !== f.firstSeen && <span>Last seen {timeAgo(f.lastSeen)}</span>}
        <a href={f.url} target="_blank" rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-dna-400 hover:text-dna-300">
          <ExternalLink size={10} /> Open source
        </a>
      </div>

      {!settled ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" disabled={busy} onClick={() => onDecide('CONFIRMED')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-700
                       px-2.5 py-1.5 text-2xs font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            This is our work
          </button>
          <button type="button" disabled={busy} onClick={() => onDecide('DISMISSED')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-bg-border
                       bg-bg-elevated hover:bg-bg-card px-2.5 py-1.5 text-2xs font-semibold
                       text-gray-300 disabled:opacity-50">
            <X size={11} /> Not related
          </button>
          <span className="text-2xs text-gray-600 inline-flex items-center gap-1">
            <Info size={10} /> Your decision — the system does not judge this.
          </span>
        </div>
      ) : (
        <p className="text-2xs text-gray-500">
          {f.status === 'CONFIRMED'
            ? 'Confirmed as your work. This can support an investigation.'
            : 'Dismissed as unrelated.'}
        </p>
      )}
    </li>
  );
}
