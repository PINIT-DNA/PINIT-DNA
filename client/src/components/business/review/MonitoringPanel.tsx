/**
 * Campaign → Monitoring.
 *
 * The first thing this screen has to do is tell the truth about whether
 * anything is actually being watched. Reverse image search is not configured in
 * every environment, and a monitoring page that looks alive while nothing is
 * scanning is worse than one that says so — someone will believe their work is
 * protected when it is not.
 *
 * So capability comes first, in plain words, before any per-asset detail. The
 * counts below it are read from the existing monitor engine; none is invented,
 * and an asset that has never been scanned says exactly that.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Radar, RadioTower, AlertTriangle, RefreshCw, Loader2, Power, PowerOff,
  Clock, Search, Info, ShieldQuestion, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listCampaignMonitoring, enableMonitoring, disableMonitoring,
} from '../../../services/business.api';
import type { CampaignMonitoring, MonitoredAsset } from '../../../services/business.api';
import { SectionCard, SkeletonRows, StatTile } from '../clients/BusinessKit';
import { timeAgo } from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function MonitoringPanel({
  campaignId, onChanged,
}: {
  campaignId: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<CampaignMonitoring | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listCampaignMonitoring(campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load monitoring');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (a: MonitoredAsset) => {
    setBusyId(a.assetId);
    try {
      if (a.monitoring?.enabled) {
        await disableMonitoring(campaignId, a.assetId);
        toast.success('Monitoring stopped');
      } else {
        await enableMonitoring(campaignId, a.assetId);
        toast.success('Monitoring enabled');
      }
      await load();
      onChanged?.();
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not change monitoring');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <SkeletonRows rows={4} />;

  if (error) {
    return (
      <SectionCard title="Monitoring" icon={Radar}>
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
          <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Couldn't load monitoring</p>
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
  const cap = data.capability;
  const fullyWorking = cap.crawlerEnabled && cap.reverseImageAvailable;

  return (
    <div className="space-y-4">
      {/* Capability first — never let the page imply it is watching when it is not. */}
      <div className={cn(
        'rounded-xl border px-4 py-3.5',
        fullyWorking
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-amber-500/30 bg-amber-500/5',
      )}>
        <p className={cn('text-sm font-semibold flex items-center gap-2',
          fullyWorking ? 'text-emerald-400' : 'text-amber-400')}>
          {fullyWorking
            ? <><RadioTower size={15} /> Monitoring is active</>
            : <><ShieldQuestion size={15} /> Discovery is not fully configured</>}
        </p>
        <p className="text-xs text-gray-400 mt-1">{cap.summary}</p>

        <ul className="mt-2.5 space-y-1.5">
          {cap.providers.map((p) => (
            <li key={p.id} className="flex items-start gap-2">
              <span className={cn('mt-0.5 w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center',
                p.configured
                  ? 'bg-emerald-500/20 border-emerald-500/40'
                  : 'bg-bg-elevated border-bg-border')}>
                {p.configured && <CheckCircle2 size={9} className="text-emerald-400" />}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-2xs font-semibold',
                  p.configured ? 'text-gray-300' : 'text-gray-500')}>
                  {p.label} — {p.configured ? 'available' : 'not configured'}
                </span>
                <span className="block text-2xs text-gray-500">{p.finds}</span>
                {p.requires && (
                  <span className="block text-2xs text-amber-400/80 mt-0.5">Needs: {p.requires}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {data.assets.length === 0 ? (
        <SectionCard title="Monitoring" icon={Radar}>
          <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
            <Radar size={20} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white mb-0.5">No assets to monitor yet</p>
            <p className="text-xs text-gray-400">Protect an asset into this campaign first.</p>
          </div>
        </SectionCard>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Monitored" value={data.totals.monitored} icon={RadioTower} accent="dna" />
            <StatTile label="Findings" value={data.totals.findings} icon={Search} accent="cyan" />
            <StatTile label="Need review" value={data.totals.needsReview} icon={ShieldQuestion} accent="amber" />
            <StatTile label="Confirmed" value={data.totals.confirmed} icon={AlertTriangle} accent="rose" />
          </div>

          <SectionCard title="Assets" icon={Radar}>
            <ul className="space-y-2.5">
              {data.assets.map((a) => (
                <AssetRow key={a.assetId} asset={a} busy={busyId === a.assetId}
                  onToggle={() => void toggle(a)} crawlerEnabled={cap.crawlerEnabled} />
              ))}
            </ul>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function AssetRow({
  asset: a, busy, onToggle, crawlerEnabled,
}: {
  asset: MonitoredAsset; busy: boolean; onToggle: () => void; crawlerEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const on = a.monitoring?.enabled ?? false;

  return (
    <li className="rounded-xl border border-bg-border bg-bg-card">
      <div className="p-3 flex items-start gap-3">
        <span className={cn(
          'mt-0.5 w-8 h-8 rounded-lg border flex items-center justify-center shrink-0',
          on ? 'bg-dna-500/10 border-dna-500/30 text-dna-400'
             : 'bg-bg-elevated border-bg-border text-gray-500',
        )}>
          <Radar size={15} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{a.filename}</p>

          {!a.canMonitor ? (
            <p className="text-2xs text-gray-500 mt-0.5">
              No DNA record — there is nothing to match against. Protect it first.
            </p>
          ) : !on ? (
            <p className="text-2xs text-gray-500 mt-0.5">Not being monitored.</p>
          ) : (
            <p className="text-2xs text-gray-500 mt-0.5 flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Clock size={10} />
                {a.monitoring!.lastScanAt
                  ? `Last scan ${timeAgo(a.monitoring!.lastScanAt)}`
                  : 'Never scanned yet'}
              </span>
              <span>{a.monitoring!.totalScans} scan{a.monitoring!.totalScans === 1 ? '' : 's'}</span>
              {a.findings.total > 0 && (
                <span className="text-amber-400">
                  {a.findings.total} finding{a.findings.total === 1 ? '' : 's'}
                  {a.findings.needsReview > 0 && ` · ${a.findings.needsReview} need review`}
                </span>
              )}
            </p>
          )}

          {on && !crawlerEnabled && (
            <p className="text-2xs text-amber-400/80 mt-1 flex items-start gap-1.5">
              <Info size={10} className="shrink-0 mt-0.5" />
              Enrolled, but background scanning is off here — no new findings will appear until it is on.
            </p>
          )}

          {on && a.recentScans.length > 0 && (
            <button type="button" onClick={() => setOpen(!open)}
              className="text-2xs font-semibold text-dna-400 hover:text-dna-300 mt-1.5">
              {open ? 'Hide' : 'Show'} scan history
            </button>
          )}
        </div>

        {a.canMonitor && (
          <button
            type="button"
            disabled={busy}
            onClick={onToggle}
            className={cn(
              'shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-2xs font-semibold border transition-colors disabled:opacity-50',
              on
                ? 'border-bg-border bg-bg-elevated text-gray-300 hover:text-white'
                : 'border-dna-600 bg-dna-500 text-white hover:bg-dna-600',
            )}
          >
            {busy ? <Loader2 size={12} className="animate-spin" />
                  : on ? <PowerOff size={12} /> : <Power size={12} />}
            {on ? 'Stop' : 'Monitor'}
          </button>
        )}
      </div>

      {open && a.recentScans.length > 0 && (
        <ul className="border-t border-bg-border/70 divide-y divide-bg-border/50">
          {a.recentScans.map((s) => (
            <li key={s.id} className="px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-2xs text-gray-400">
                {timeAgo(s.startedAt)} · {s.trigger.toLowerCase()}
              </span>
              <span className="text-2xs text-gray-500">
                {s.status === 'FAILED'
                  ? <span className="text-danger">failed{s.failureReason ? ` — ${s.failureReason.slice(0, 40)}` : ''}</span>
                  : `${s.candidatesFound} checked · ${s.matchesFound} match${s.matchesFound === 1 ? '' : 'es'}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
