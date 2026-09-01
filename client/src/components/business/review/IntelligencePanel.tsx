/**
 * Campaign Intelligence.
 *
 * Answers "what is happening with our protected work?" from real rows only.
 * Every figure is a count of something that exists; nothing is estimated to
 * make the page look complete.
 *
 * The findings section is deliberately qualified by whether discovery is
 * actually running. A confident "0 findings" and an unanswerable one look
 * identical on a tile and mean opposite things, so the tile does not stand
 * alone — it carries the reason.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles, ShieldCheck, GitBranch, Users, Radar, PackageCheck,
  AlertTriangle, RefreshCw, Share2, Activity, ExternalLink, FileSearch, Info,
} from 'lucide-react';
import { getCampaignIntelligence } from '../../../services/business.api';
import type { CampaignIntelligence } from '../../../services/business.api';
import { SectionCard, SkeletonRows } from '../clients/BusinessKit';
import { timeAgo } from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function IntelligencePanel({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<CampaignIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getCampaignIntelligence(campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load intelligence');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <SkeletonRows rows={5} />;

  if (error) {
    return (
      <SectionCard title="Intelligence" icon={Sparkles}>
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
          <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Couldn't load intelligence</p>
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

  if (data.protection.assets === 0) {
    return (
      <SectionCard title="Intelligence" icon={Sparkles}>
        <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-10 text-center">
          <Sparkles size={20} className="text-gray-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-0.5">Nothing to report yet</p>
          <p className="text-xs text-gray-400">
            Protect an asset into this campaign and its whole story appears here.
          </p>
        </div>
      </SectionCard>
    );
  }

  const p = data.protection;
  const r = data.review;
  const f = data.findings;
  const m = data.monitoring;
  const discoveryWorking = m.capability.crawlerEnabled && m.capability.anyProviderOperational;

  return (
    <div className="space-y-4">
      {/* Headline — what is waiting on someone */}
      <NeedsAttention data={data} />

      {/* Protection & review */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Protection" icon={ShieldCheck}>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Assets" value={p.assets} />
            <Metric label="With DNA" value={p.withDna} of={p.assets} />
            <Metric label="In vault" value={p.withVault} of={p.assets} />
            <Metric label="Certified" value={p.withCertificate} of={p.assets}
              note={p.withCertificate < p.assets ? 'Not every asset has a certificate.' : undefined} />
          </div>
        </SectionCard>

        <SectionCard title="Review" icon={GitBranch}>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Versions" value={r.versions} />
            <Metric label="Approved" value={r.approved} tone={r.approved > 0 ? 'good' : undefined} />
            <Metric label="In review" value={r.inReview} tone={r.inReview > 0 ? 'busy' : undefined} />
            <Metric label="Open requests" value={r.openChangeRequests}
              tone={r.openChangeRequests > 0 ? 'warn' : undefined} />
          </div>
          {r.versions === 0 && (
            <p className="text-2xs text-gray-500 mt-2.5">
              No versions yet — a version is created the first time an asset is opened for review.
            </p>
          )}
        </SectionCard>
      </div>

      {/* Monitoring & findings — findings never stand alone */}
      <SectionCard title="External discovery" icon={Radar}>
        <div className={cn('rounded-lg border px-3 py-2.5 mb-3',
          discoveryWorking
            ? 'border-emerald-500/25 bg-emerald-500/5'
            : 'border-amber-500/25 bg-amber-500/5')}>
          <p className={cn('text-2xs font-semibold flex items-start gap-1.5',
            discoveryWorking ? 'text-emerald-400' : 'text-amber-400')}>
            <Info size={11} className="shrink-0 mt-0.5" />
            {m.capability.summary}
          </p>
          {!discoveryWorking && (
            <p className="text-2xs text-gray-500 mt-1">
              Read the figures below with that in mind: nothing found is not the same as nothing
              out there.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric label="Monitored" value={m.monitored} of={m.monitorable} />
          <Metric label="Scans run" value={m.totalScans} />
          <Metric label="Findings" value={f.total}
            note={f.total === 0 && !discoveryWorking ? 'Nothing has been able to look.' : undefined} />
          <Metric label="High priority" value={f.highPriority}
            tone={f.highPriority > 0 ? 'bad' : undefined} />
        </div>

        {f.total > 0 && (
          <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-bg-border/70">
            <Metric label="Need review" value={f.needsReview} tone={f.needsReview > 0 ? 'warn' : undefined} />
            <Metric label="Confirmed" value={f.confirmed} tone={f.confirmed > 0 ? 'bad' : undefined} />
            <Metric label="Dismissed" value={f.dismissed} />
          </div>
        )}

        {m.lastScanAt && (
          <p className="text-2xs text-gray-500 mt-2.5">Last scan {timeAgo(m.lastScanAt)}</p>
        )}
      </SectionCard>

      {/* People & delivery */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Client" icon={Users}>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Approvals given" value={data.client.approvalsGiven}
              tone={data.client.approvalsGiven > 0 ? 'good' : undefined} />
            <Metric label="Changes requested" value={data.client.changesRequested} />
            <Metric label="Comments" value={data.client.commentsWritten} />
            <Metric label="Messages" value={data.client.messagesSent}
              note={data.client.unreadFromClient > 0
                ? `${data.client.unreadFromClient} unread` : undefined}
              tone={data.client.unreadFromClient > 0 ? 'warn' : undefined} />
          </div>
          <p className="text-2xs text-gray-500 mt-2.5">
            {data.client.lastHeardFrom
              ? `Last heard from ${timeAgo(data.client.lastHeardFrom)}.`
              : 'The client has not commented or messaged yet.'}
          </p>
        </SectionCard>

        <SectionCard title="External creators" icon={ExternalLink}>
          {data.creators.total === 0 ? (
            <p className="text-xs text-gray-400 py-2">
              No external creators on this campaign.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Total" value={data.creators.total} />
                <Metric label="With access" value={data.creators.withAccess} />
                <Metric label="Revoked" value={data.creators.revoked} />
              </div>
              <ul className="mt-2.5 space-y-1">
                {data.creators.people.slice(0, 4).map((c, i) => (
                  <li key={`${c.name}-${i}`} className="text-2xs text-gray-400 truncate">
                    {c.name} · {c.assetCount} asset{c.assetCount === 1 ? '' : 's'} ·{' '}
                    <span className="text-gray-500">{c.accessStatus.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>
      </div>

      {/* Investigations & handover */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Investigations" icon={FileSearch}>
          {data.investigations.total === 0 ? (
            <p className="text-xs text-gray-400 py-2">
              No investigations opened for this campaign's assets.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Open" value={data.investigations.open}
                  tone={data.investigations.open > 0 ? 'warn' : undefined} />
                <Metric label="Resolved" value={data.investigations.resolved} />
                <Metric label="Evidence" value={data.investigations.evidenceItems} />
              </div>
              <ul className="mt-2.5 space-y-1">
                {data.investigations.recent.map((i) => (
                  <li key={i.code} className="text-2xs text-gray-400 truncate">
                    <span className="mono">{i.code}</span> · {i.severity.toLowerCase()} ·{' '}
                    <span className={i.resolvedAt ? 'text-gray-500' : 'text-amber-400'}>
                      {i.resolvedAt ? 'resolved' : i.status.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <SectionCard title="Delivery" icon={PackageCheck}>
          {data.handover.total === 0 ? (
            <p className="text-xs text-gray-400 py-2">
              Nothing handed over yet.
              {r.approved > 0
                ? ` ${r.approved} approved version${r.approved === 1 ? '' : 's'} could be delivered.`
                : ' Approve a version first.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Received" value={data.handover.completed}
                  tone={data.handover.completed > 0 ? 'good' : undefined} />
                <Metric label="Awaiting client" value={data.handover.awaitingClient}
                  tone={data.handover.awaitingClient > 0 ? 'busy' : undefined} />
                <Metric label="Assets sent" value={data.handover.assetsDelivered} />
              </div>
              {data.handover.latest && (
                <p className="text-2xs text-gray-500 mt-2.5">
                  Latest to {data.handover.latest.recipientLabel} —{' '}
                  {data.handover.latest.openedAt
                    ? `opened ${timeAgo(data.handover.latest.openedAt)}`
                    : data.handover.latest.sentAt
                      ? `sent ${timeAgo(data.handover.latest.sentAt)}, not opened yet`
                      : 'not sent yet'}.
                </p>
              )}
            </>
          )}
        </SectionCard>
      </div>

      {/* Per-asset relationships */}
      <SectionCard title="Assets" icon={Share2}>
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 640 }}>
            <thead>
              <tr className="text-2xs uppercase tracking-wide text-gray-500">
                <th className="pb-2 font-semibold">Asset</th>
                <th className="pb-2 font-semibold">Version</th>
                <th className="pb-2 font-semibold">Protection</th>
                <th className="pb-2 font-semibold">Creators</th>
                <th className="pb-2 font-semibold">Watched</th>
                <th className="pb-2 font-semibold">Findings</th>
                <th className="pb-2 font-semibold">Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/60">
              {data.assets.map((a) => (
                <tr key={a.id} className="text-2xs">
                  <td className="py-2 pr-3 text-gray-200 max-w-[200px] truncate" title={a.filename}>
                    {a.filename}
                  </td>
                  <td className="py-2 pr-3 text-gray-400">
                    {a.version ? `v${a.version.number} · ${a.version.status.replace(/_/g, ' ').toLowerCase()}` : '—'}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex gap-1">
                      <Dot on={a.protection.dna} title="DNA record" />
                      <Dot on={a.protection.vault} title="Vault" />
                      <Dot on={a.protection.certificate} title="Certificate" />
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-400">{a.creatorsWithAccess || '—'}</td>
                  <td className="py-2 pr-3">
                    {a.monitored
                      ? <span className="text-emerald-400">yes</span>
                      : <span className="text-gray-600">no</span>}
                  </td>
                  <td className="py-2 pr-3">
                    {a.findings > 0
                      ? <span className={a.findingsNeedingReview > 0 ? 'text-amber-400' : 'text-gray-400'}>
                          {a.findings}
                        </span>
                      : <span className="text-gray-600">0</span>}
                  </td>
                  <td className="py-2">
                    {a.handedOver
                      ? <span className="text-emerald-400">yes</span>
                      : <span className="text-gray-600">no</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-gray-600 mt-2.5">
          Protection dots: DNA · vault · certificate.
        </p>
      </SectionCard>

      {data.recentActivity.length > 0 && (
        <SectionCard title="Recent activity" icon={Activity}>
          <ul className="space-y-2">
            {data.recentActivity.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-dna-400 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-xs text-gray-300 truncate">{e.title}</span>
                  <span className="block text-2xs text-gray-500">{timeAgo(e.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

/** What is waiting on someone, or an honest all-clear. */
function NeedsAttention({ data }: { data: CampaignIntelligence }) {
  const items: string[] = [];
  if (data.review.openChangeRequests > 0) {
    items.push(`${data.review.openChangeRequests} change request${data.review.openChangeRequests === 1 ? '' : 's'} open`);
  }
  if (data.client.unreadFromClient > 0) {
    items.push(`${data.client.unreadFromClient} unread message${data.client.unreadFromClient === 1 ? '' : 's'} from the client`);
  }
  if (data.findings.highPriority > 0) {
    items.push(`${data.findings.highPriority} high-priority finding${data.findings.highPriority === 1 ? '' : 's'}`);
  }
  if (data.investigations.open > 0) {
    items.push(`${data.investigations.open} open investigation${data.investigations.open === 1 ? '' : 's'}`);
  }
  if (data.review.inReview > 0) {
    items.push(`${data.review.inReview} version${data.review.inReview === 1 ? '' : 's'} awaiting the client`);
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-bg-border bg-bg-card px-4 py-3">
        <p className="text-sm font-semibold text-white">Nothing is waiting on you</p>
        <p className="text-2xs text-gray-500 mt-0.5">
          No open change requests, unread messages or findings needing review.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <p className="text-sm font-semibold text-amber-400 flex items-center gap-2">
        <AlertTriangle size={14} /> Needs attention
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((i) => (
          <li key={i} className="text-2xs text-gray-300">· {i}</li>
        ))}
      </ul>
    </div>
  );
}

function Metric({
  label, value, of, note, tone,
}: {
  label: string; value: number; of?: number; note?: string;
  tone?: 'good' | 'warn' | 'bad' | 'busy';
}) {
  const toneCls = tone === 'good' ? 'text-emerald-400'
    : tone === 'warn' ? 'text-amber-400'
    : tone === 'bad' ? 'text-rose-400'
    : tone === 'busy' ? 'text-dna-400'
    : 'text-white';
  return (
    <div className="min-w-0">
      <p className="text-2xs text-gray-500 uppercase tracking-wide truncate">{label}</p>
      <p className={cn('text-lg font-bold tabular-nums', toneCls)}>
        {value}
        {typeof of === 'number' && <span className="text-2xs text-gray-500 font-normal"> / {of}</span>}
      </p>
      {note && <p className="text-2xs text-gray-500 mt-0.5">{note}</p>}
    </div>
  );
}

function Dot({ on, title }: { on: boolean; title: string }) {
  return (
    <span title={`${title}: ${on ? 'yes' : 'no'}`}
      className={cn('w-1.5 h-1.5 rounded-full inline-block',
        on ? 'bg-emerald-400' : 'bg-gray-600')} />
  );
}
