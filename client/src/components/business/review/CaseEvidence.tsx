/**
 * Case → Evidence → Client report.
 *
 * Two panels that sit inside a case: the evidence collected against it, and the
 * reports issued from it.
 *
 * The evidence timeline shows the chain explicitly — which asset, which finding,
 * where each item came from and when — because "we found something" is only
 * useful to a client if it is clear what was found and how it connects to their
 * work.
 *
 * The report panel shows the team exactly what the client will see before it is
 * issued. That preview is the same frozen snapshot the client's PDF renders
 * from, so what is checked here is what goes out.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  FileCheck2, Plus, Loader2, ExternalLink, Link2, AlertTriangle, RefreshCw,
  FileText, Send, Ban, Eye, Copy, ShieldCheck, Clock, Inbox,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listInvestigationEvidence, collectEvidence,
  listClientReports, createClientReport, updateClientReport, clientReportPdfUrl,
} from '../../../services/business.api';
import type {
  InvestigationEvidence, ClientReport, ClientReportSnapshot,
} from '../../../services/business.api';
import { SectionCard, SkeletonRows } from '../clients/BusinessKit';
import { timeAgo } from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const errText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

/** Human labels for the stored evidence type codes. */
const TYPE_LABEL: Record<string, string> = {
  CRAWLER_MATCH: 'Automated match',
  MANUAL_SIGHTING: 'Reported sighting',
  PAGE_CAPTURE: 'Page capture',
  CLIENT_REPORT: 'From the client',
  ACCESS_ANOMALY: 'Unusual access',
};

const label = (t: string) => TYPE_LABEL[t] ?? t.replace(/_/g, ' ').toLowerCase();

// ── Evidence ────────────────────────────────────────────────────────────────

export function CaseEvidencePanel({
  investigationId, onChanged,
}: {
  investigationId: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<InvestigationEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listInvestigationEvidence(investigationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load evidence');
    } finally {
      setLoading(false);
    }
  }, [investigationId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <SkeletonRows rows={3} />;

  if (error) {
    return (
      <SectionCard title="Evidence" icon={FileCheck2}>
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
          <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Couldn't load evidence</p>
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

  return (
    <SectionCard title={`Evidence (${data.counts.total})`} icon={FileCheck2}>
      <div className="space-y-3">
        {/* The chain, stated once. */}
        {(data.relatedAsset || data.relatedFinding) && (
          <div className="rounded-lg border border-bg-border bg-bg-elevated/40 px-2.5 py-2 space-y-1">
            <p className="text-2xs font-semibold text-gray-400">What this case concerns</p>
            {data.relatedAsset && (
              <p className="text-2xs text-gray-300">
                <span className="text-gray-500">Asset:</span> {data.relatedAsset.filename}
              </p>
            )}
            {data.relatedFinding && (
              <p className="text-2xs text-gray-300 flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-500">Found on:</span>
                {data.relatedFinding.host ?? 'unknown host'}
                <span className="text-gray-500">
                  ({(data.relatedFinding.similarity * 100).toFixed(0)}% similar)
                </span>
                <a href={data.relatedFinding.url} target="_blank" rel="noreferrer noopener"
                  className="text-dna-400 hover:text-dna-300 inline-flex items-center gap-1">
                  <ExternalLink size={10} /> open
                </a>
              </p>
            )}
          </div>
        )}

        {data.evidence.length === 0 ? (
          <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-7 text-center">
            <Inbox size={20} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white mb-1">No evidence collected yet</p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Evidence is what a client report is built from. Add what you have — a
              sighting someone reported, a capture of the page, or something the
              client sent you.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {data.evidence.map((e, i) => (
              <li key={e.id} className="relative rounded-xl border border-bg-border bg-bg-card p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white">
                      <span className="text-gray-600 mr-1.5">{i + 1}.</span>
                      {label(e.type)}
                    </p>
                    <p className="text-2xs text-gray-500 font-mono">{e.code}</p>
                  </div>
                  <span className="text-2xs text-gray-500 inline-flex items-center gap-1 whitespace-nowrap">
                    <Clock size={10} /> {timeAgo(e.collectedAt)}
                  </span>
                </div>

                <p className="text-2xs text-gray-500 italic mb-1.5">{e.meaning}</p>
                <p className="text-xs text-gray-300 whitespace-pre-wrap mb-1.5">{e.description}</p>

                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-2xs">
                  {e.sourceHost && (
                    <a href={e.sourceUrl ?? '#'} target="_blank" rel="noreferrer noopener"
                      className="text-dna-400 hover:text-dna-300 inline-flex items-center gap-1">
                      <Link2 size={10} /> {e.sourceHost}
                    </a>
                  )}
                  {e.integrity ? (
                    <span className="text-gray-500 inline-flex items-center gap-1">
                      <ShieldCheck size={10} className="text-emerald-500" />
                      <span className="font-mono">{e.integrity}</span>
                    </span>
                  ) : (
                    <span className="text-amber-500/80">No integrity value recorded</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {adding ? (
          <CollectForm
            types={data.collectableTypes}
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              const created = await collectEvidence(investigationId, input);
              toast.success(`Evidence ${created.code} added`);
              setAdding(false);
              await load();
              onChanged?.();
            }}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)}
            className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
            <Plus size={13} /> Add evidence
          </button>
        )}
      </div>
    </SectionCard>
  );
}

function CollectForm({
  types, onCancel, onSubmit,
}: {
  types: { id: string; meaning: string }[];
  onCancel: () => void;
  onSubmit: (input: { evidenceType: string; description: string; sourceUrl?: string }) => Promise<void>;
}) {
  const [evidenceType, setType] = useState(types[0]?.id ?? 'MANUAL_SIGHTING');
  const [description, setDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = types.find((t) => t.id === evidenceType);

  const submit = async () => {
    if (!description.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        evidenceType,
        description: description.trim(),
        ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
      });
    } catch (err) {
      toast.error(errText(err, 'Could not add that'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-dna-500/25 bg-bg-elevated/40 p-3 space-y-2.5">
      <div>
        <span className="block text-2xs font-semibold text-gray-400 mb-1.5">What kind?</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {types.map((t) => (
            <button key={t.id} type="button" onClick={() => setType(t.id)}
              aria-pressed={evidenceType === t.id}
              className={cn(
                'px-2.5 py-1 rounded-lg text-2xs font-semibold border transition-colors',
                evidenceType === t.id
                  ? 'bg-dna-500 text-white border-dna-600'
                  : 'text-gray-400 bg-bg-card border-bg-border hover:text-white',
              )}>
              {label(t.id)}
            </button>
          ))}
        </div>
        {chosen && <p className="text-2xs text-gray-500 italic mt-1.5">{chosen.meaning}</p>}
      </div>

      <div>
        <label htmlFor="ev-desc" className="block text-2xs font-semibold text-gray-400 mb-1">
          What is it?
        </label>
        <textarea id="ev-desc" rows={2} value={description} maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="The client sent a screenshot of the image on a competitor product page."
          className="input w-full text-sm resize-y" />
      </div>

      <div>
        <label htmlFor="ev-url" className="block text-2xs font-semibold text-gray-400 mb-1">
          Where <span className="text-gray-600 font-normal">(optional)</span>
        </label>
        <input id="ev-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://example.com/the-page-it-appears-on"
          className="input w-full text-sm" />
        <p className="text-2xs text-gray-600 mt-1">
          The page the copy actually appears on — not a search results page.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || !description.trim()} onClick={() => void submit()}
          className="btn btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add evidence
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary text-xs">Cancel</button>
      </div>
    </div>
  );
}

// ── Client reports ──────────────────────────────────────────────────────────

export function CaseReportsPanel({
  investigationId, campaignId, evidenceCount,
}: {
  investigationId: string;
  campaignId: string;
  evidenceCount: number;
}) {
  const [reports, setReports] = useState<ClientReport[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<ClientReportSnapshot | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { reports: all } = await listClientReports(campaignId);
      setReports(all.filter((r) => r.investigationId === investigationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reports');
    } finally {
      setLoading(false);
    }
  }, [campaignId, investigationId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (r: ClientReport, action: 'ISSUE' | 'REVOKE') => {
    setBusyId(r.id);
    try {
      await updateClientReport(r.id, action);
      toast.success(action === 'ISSUE' ? 'Report issued' : 'Access revoked');
      await load();
    } catch (err) {
      toast.error(errText(err, 'Could not do that'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <SkeletonRows rows={2} />;

  if (error) {
    return (
      <SectionCard title="Client reports" icon={FileText}>
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
          <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Couldn't load reports</p>
          <p className="text-xs text-gray-400 mb-3">{error}</p>
          <button type="button" onClick={load}
            className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      </SectionCard>
    );
  }

  if (previewing) {
    return (
      <SectionCard title="What the client will see" icon={Eye}>
        <button type="button" onClick={() => setPreviewing(null)}
          className="text-xs text-gray-400 hover:text-white mb-3">← Back to reports</button>
        <ClientReportView snapshot={previewing} />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Client reports" icon={FileText}>
      <div className="space-y-3">
        {(reports?.length ?? 0) === 0 && !drafting && (
          <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-7 text-center">
            <FileText size={20} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white mb-1">No report issued yet</p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              A report turns this case into something you can send the client. It shows
              the campaign, the work, what was found and the evidence — and nothing
              internal.
            </p>
          </div>
        )}

        {reports?.map((r) => (
          <div key={r.id} className={cn(
            'rounded-xl border bg-bg-card p-3',
            r.status === 'ISSUED' && !r.isExpired ? 'border-emerald-500/25'
              : r.status === 'REVOKED' ? 'border-bg-border opacity-80'
              : 'border-bg-border',
          )}>
            <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{r.title}</p>
                <p className="text-2xs text-gray-500 font-mono">{r.reportCode}</p>
              </div>
              <StatusChip report={r} />
            </div>

            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-2xs text-gray-500 mb-2">
              <span>{r.evidenceCount} evidence item{r.evidenceCount === 1 ? '' : 's'}</span>
              {r.issuedAt && <span>Issued {timeAgo(r.issuedAt)}</span>}
              {r.openCount > 0
                ? <span className="text-emerald-400">Opened {r.openCount}×</span>
                : r.status === 'ISSUED' && <span>Not opened yet</span>}
              {r.expiresAt && (
                <span className={r.isExpired ? 'text-amber-400' : undefined}>
                  {r.isExpired ? 'Expired' : `Expires ${new Date(r.expiresAt).toLocaleDateString()}`}
                </span>
              )}
              {r.seal && <span className="font-mono text-gray-600">{r.seal}</span>}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {r.preview && (
                <button type="button" onClick={() => setPreviewing(r.preview)}
                  className="btn btn-secondary text-2xs inline-flex items-center gap-1">
                  <Eye size={11} /> Preview
                </button>
              )}
              <a href={clientReportPdfUrl(r.id)} target="_blank" rel="noreferrer noopener"
                className="btn btn-secondary text-2xs inline-flex items-center gap-1">
                <FileText size={11} /> PDF
              </a>
              {r.status === 'DRAFT' && (
                <button type="button" disabled={busyId === r.id} onClick={() => void act(r, 'ISSUE')}
                  className="btn btn-primary text-2xs inline-flex items-center gap-1 disabled:opacity-50">
                  {busyId === r.id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                  Issue to client
                </button>
              )}
              {r.status === 'ISSUED' && (
                <>
                  <button type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/client-report/${r.accessToken}`;
                      void navigator.clipboard.writeText(url);
                      toast.success('Client link copied');
                    }}
                    className="btn btn-secondary text-2xs inline-flex items-center gap-1">
                    <Copy size={11} /> Copy link
                  </button>
                  <button type="button" disabled={busyId === r.id} onClick={() => void act(r, 'REVOKE')}
                    className="btn btn-secondary text-2xs inline-flex items-center gap-1 text-rose-400 disabled:opacity-50">
                    <Ban size={11} /> Revoke
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

        {drafting ? (
          <DraftForm
            evidenceCount={evidenceCount}
            onCancel={() => setDrafting(false)}
            onSubmit={async (input) => {
              const created = await createClientReport(investigationId, input);
              toast.success(`Report ${created.reportCode} drafted`);
              setDrafting(false);
              await load();
            }}
          />
        ) : (
          <button type="button" onClick={() => setDrafting(true)}
            className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
            <Plus size={13} /> Draft a report
          </button>
        )}
      </div>
    </SectionCard>
  );
}

function StatusChip({ report: r }: { report: ClientReport }) {
  const [cls, txt] =
    r.status === 'REVOKED' ? ['text-gray-500 bg-bg-elevated border-bg-border', 'Revoked']
    : r.isExpired ? ['text-amber-400 bg-amber-500/10 border-amber-500/30', 'Expired']
    : r.status === 'ISSUED' ? ['text-emerald-400 bg-emerald-500/10 border-emerald-500/30', 'Live']
    : ['text-gray-400 bg-bg-elevated border-bg-border', 'Draft'];
  return (
    <span className={cn('text-2xs font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap', cls)}>
      {txt}
    </span>
  );
}

function DraftForm({
  evidenceCount, onCancel, onSubmit,
}: {
  evidenceCount: number;
  onCancel: () => void;
  onSubmit: (i: { title?: string; summary?: string; expiresInDays?: number }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [expires, setExpires] = useState('90');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const days = parseInt(expires, 10);
      await onSubmit({
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(Number.isFinite(days) && days > 0 ? { expiresInDays: days } : {}),
      });
    } catch (err) {
      toast.error(errText(err, 'Could not draft the report'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-dna-500/25 bg-bg-elevated/40 p-3 space-y-2.5">
      {evidenceCount === 0 && (
        <p className="text-2xs text-amber-400 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2">
          There is no evidence on this case yet. The report will record the case as it
          stands and will not claim anything was found.
        </p>
      )}

      <div>
        <label htmlFor="rp-title" className="block text-2xs font-semibold text-gray-400 mb-1">
          Title <span className="text-gray-600 font-normal">(optional)</span>
        </label>
        <input id="rp-title" value={title} maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Protection report — Q3 product shoot"
          className="input w-full text-sm" />
      </div>

      <div>
        <label htmlFor="rp-summary" className="block text-2xs font-semibold text-gray-400 mb-1">
          Summary for the client
        </label>
        <textarea id="rp-summary" rows={3} value={summary} maxLength={4000}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Write this for the client. Your case notes are never included."
          className="input w-full text-sm resize-y" />
        <p className="text-2xs text-gray-600 mt-1">
          Internal case notes are never used here — only what you write.
        </p>
      </div>

      <div>
        <label htmlFor="rp-exp" className="block text-2xs font-semibold text-gray-400 mb-1">
          Link expires after
        </label>
        <select id="rp-exp" value={expires} onChange={(e) => setExpires(e.target.value)}
          className="input text-sm">
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="180">180 days</option>
          <option value="365">1 year</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void submit()}
          className="btn btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
          Draft report
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary text-xs">Cancel</button>
      </div>
      <p className="text-2xs text-gray-600">
        A draft is not visible to anyone outside your team until you issue it.
      </p>
    </div>
  );
}

/**
 * The client's view of a report.
 *
 * Shared between the team's preview and the public page, so what the team
 * checks is literally the component the client gets.
 */
export function ClientReportView({ snapshot: s }: { snapshot: ClientReportSnapshot }) {
  return (
    <article className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-white">{s.title}</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Prepared by {s.preparedBy}
          {s.preparedFor && <> for {s.preparedFor}</>}
        </p>
        <p className="text-2xs text-gray-600 font-mono mt-1">{s.reportCode}</p>
      </header>

      {s.summary && (
        <section className="rounded-xl border border-bg-border bg-bg-card p-3">
          <h3 className="text-2xs font-semibold text-gray-400 mb-1.5">Summary</h3>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{s.summary}</p>
        </section>
      )}

      <section className="rounded-xl border border-bg-border bg-bg-card p-3 space-y-1">
        <h3 className="text-2xs font-semibold text-gray-400 mb-1.5">Campaign</h3>
        <p className="text-sm text-white">{s.campaign.name}</p>
        <p className="text-2xs text-gray-500">Status: {s.caseStatus}</p>
      </section>

      {s.asset && (
        <section className="rounded-xl border border-bg-border bg-bg-card p-3 space-y-1">
          <h3 className="text-2xs font-semibold text-gray-400 mb-1.5">The work</h3>
          <p className="text-sm text-white">{s.asset.filename}</p>
          <p className="text-2xs text-gray-500">
            {[
              s.asset.isFingerprinted && 'fingerprinted',
              s.asset.isVaulted && 'held in the vault',
              s.asset.isCertified && 'certified',
            ].filter(Boolean).join(' · ') || 'No protection recorded'}
          </p>
          {s.asset.protectedOn && (
            <p className="text-2xs text-gray-600">
              Protected since {new Date(s.asset.protectedOn).toLocaleDateString()}
            </p>
          )}
        </section>
      )}

      {s.finding && (
        <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 space-y-1">
          <h3 className="text-2xs font-semibold text-gray-400 mb-1.5">What was found</h3>
          <p className="text-sm text-white">{s.finding.host ?? 'Unknown source'}</p>
          <p className="text-2xs text-gray-400">
            {s.finding.confidence} — {s.finding.similarityPercent}% similar
          </p>
          <p className="text-2xs text-gray-500 italic pt-1">
            A match describes how closely a copy resembles your work. It is an
            observation, not a legal conclusion.
          </p>
        </section>
      )}

      <section>
        <h3 className="text-2xs font-semibold text-gray-400 mb-2">
          Evidence collected ({s.evidence.length})
        </h3>
        {s.evidence.length === 0 ? (
          <p className="text-xs text-gray-500 rounded-lg border border-dashed border-bg-border px-3 py-4">
            No evidence has been collected against this case yet. This report records the
            case as it stands; it does not assert that anything was found.
          </p>
        ) : (
          <ol className="space-y-2">
            {s.evidence.map((e) => (
              <li key={e.reference} className="rounded-xl border border-bg-border bg-bg-card p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <p className="text-xs font-semibold text-white">{label(e.type)}</p>
                  <span className="text-2xs text-gray-500 font-mono">{e.reference}</span>
                </div>
                <p className="text-2xs text-gray-500 italic mb-1">{e.meaning}</p>
                <p className="text-xs text-gray-300 whitespace-pre-wrap">{e.description}</p>
                <p className="text-2xs text-gray-600 mt-1.5">
                  {e.sourceHost && <>Source: {e.sourceHost} · </>}
                  Collected {new Date(e.collectedAt).toLocaleDateString()}
                  {e.integrity && <> · <span className="font-mono">{e.integrity}</span></>}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {s.outcome && (
        <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
          <h3 className="text-2xs font-semibold text-emerald-400 mb-1.5">Outcome</h3>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{s.outcome}</p>
        </section>
      )}
    </article>
  );
}
