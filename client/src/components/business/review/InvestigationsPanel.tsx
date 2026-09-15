/**
 * Campaign → Investigations.
 *
 * A case is the record of what the team did about something they found. The UI
 * keeps two boundaries the service also keeps:
 *
 *   - Notes and evidence are shown apart. A note is somebody's account; evidence
 *     is a collected artefact with an integrity hash. Presenting them in one
 *     list would let commentary read as proof.
 *
 *   - Closing is final. RESOLVED and DISMISSED leave the status control, and
 *     reopening is a separate button that asks for a reason — so a terminal
 *     state cannot be undone by a mis-click.
 *
 * Nothing here is described as infringement. The case says what was found and
 * what people decided; what it means legally is not this system's call.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Gavel, Plus, AlertTriangle, RefreshCw, Loader2, ArrowLeft, Clock,
  MessageSquare, ExternalLink, ShieldCheck, RotateCcw, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listCampaignInvestigations, createInvestigation, getInvestigation,
  addInvestigationNote, updateInvestigation,
} from '../../../services/business.api';
import type {
  CampaignInvestigations, Investigation, InvestigationDetail,
  InvestigationStatus, InvestigationPriority,
} from '../../../services/business.api';
import { SectionCard, SkeletonRows } from '../clients/BusinessKit';
import { CaseEvidencePanel, CaseReportsPanel } from './CaseEvidence';
import { timeAgo } from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const STATUS_STYLE: Record<InvestigationStatus, string> = {
  OPEN:            'text-amber-400 bg-amber-500/10 border-amber-500/30',
  INVESTIGATING:   'text-dna-400 bg-dna-500/10 border-dna-500/30',
  AWAITING_CLIENT: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
  RESOLVED:        'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  DISMISSED:       'text-gray-500 bg-bg-elevated border-bg-border',
};

const STATUS_LABEL: Record<InvestigationStatus, string> = {
  OPEN: 'Open',
  INVESTIGATING: 'Investigating',
  AWAITING_CLIENT: 'Awaiting client',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

const PRIORITY_STYLE: Record<InvestigationPriority, string> = {
  CRITICAL: 'text-rose-400',
  HIGH:     'text-amber-400',
  MEDIUM:   'text-dna-400',
  LOW:      'text-gray-500',
};

export function InvestigationsPanel({
  campaignId, onChanged, initialCaseId,
}: {
  campaignId: string;
  onChanged?: () => void;
  initialCaseId?: string | null;
}) {
  const [data, setData] = useState<CampaignInvestigations | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(initialCaseId ?? null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listCampaignInvestigations(campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load investigations');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <SkeletonRows rows={4} />;

  if (error) {
    return (
      <SectionCard title="Investigations" icon={Gavel}>
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
          <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Couldn't load investigations</p>
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

  if (openCaseId) {
    return (
      <CaseDetail
        investigationId={openCaseId}
        onBack={() => { setOpenCaseId(null); void load(); onChanged?.(); }}
      />
    );
  }

  const c = data.counts;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap text-2xs text-gray-500">
          {c.total > 0 && (
            <>
              <span><span className="text-white font-semibold">{c.active}</span> active</span>
              <span><span className="text-white font-semibold">{c.resolved}</span> resolved</span>
              <span><span className="text-white font-semibold">{c.dismissed}</span> dismissed</span>
            </>
          )}
        </div>
        <button type="button" onClick={() => setCreating(true)}
          className="btn btn-primary text-xs inline-flex items-center gap-1.5">
          <Plus size={13} /> Open a case
        </button>
      </div>

      {creating && (
        <NewCaseForm
          campaignId={campaignId}
          vocabulary={data.vocabulary}
          onCancel={() => setCreating(false)}
          onCreated={(inv) => {
            setCreating(false);
            void load();
            onChanged?.();
            setOpenCaseId(inv.id);
          }}
        />
      )}

      <SectionCard title="Investigations" icon={Gavel}>
        {data.investigations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
            <ShieldCheck size={20} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white mb-1">No investigations open</p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Cases appear here when someone escalates a confirmed match, or opens one
              directly for something raised off-platform. Nothing is opened automatically.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {data.investigations.map((inv) => (
              <CaseRow key={inv.id} investigation={inv} onOpen={() => setOpenCaseId(inv.id)} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function CaseRow({
  investigation: inv, onOpen,
}: {
  investigation: Investigation; onOpen: () => void;
}) {
  return (
    <li>
      <button type="button" onClick={onOpen}
        className={cn(
          'w-full text-left rounded-xl border bg-bg-card p-3 transition-colors',
          'hover:border-dna-500/40',
          inv.isTerminal ? 'border-bg-border opacity-85' : 'border-amber-500/25',
        )}>
        <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{inv.title}</p>
            <p className="text-2xs text-gray-500 font-mono">{inv.caseCode}</p>
          </div>
          <span className={cn(
            'text-2xs font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap',
            STATUS_STYLE[inv.status],
          )}>
            {STATUS_LABEL[inv.status]}
          </span>
        </div>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-2xs text-gray-500">
          <span className={cn('font-semibold', PRIORITY_STYLE[inv.priority])}>
            {inv.priority}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={10} /> Opened {timeAgo(inv.createdAt)}
          </span>
          {inv.findingId && <span>From a confirmed match</span>}
        </div>
      </button>
    </li>
  );
}

function NewCaseForm({
  campaignId, vocabulary, onCancel, onCreated,
}: {
  campaignId: string;
  vocabulary: CampaignInvestigations['vocabulary'];
  onCancel: () => void;
  onCreated: (inv: Investigation) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<InvestigationPriority>('MEDIUM');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const inv = await createInvestigation(campaignId, {
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        priority,
      });
      toast.success(`Case ${inv.caseCode} opened`);
      onCreated(inv);
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not open the case');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Open a case" icon={Plus}>
      <div className="space-y-3">
        <div>
          <label htmlFor="case-title" className="block text-2xs font-semibold text-gray-400 mb-1">
            What is this about?
          </label>
          <input
            id="case-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Client reported our shot on a competitor's site"
            className="input w-full text-sm"
          />
        </div>
        <div>
          <label htmlFor="case-desc" className="block text-2xs font-semibold text-gray-400 mb-1">
            Detail <span className="text-gray-600 font-normal">(optional)</span>
          </label>
          <textarea
            id="case-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Where it was seen, who reported it, what has been checked so far."
            className="input w-full text-sm resize-y"
          />
        </div>
        <div>
          <span className="block text-2xs font-semibold text-gray-400 mb-1.5">Priority</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {vocabulary.priorities.map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                aria-pressed={priority === p}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-2xs font-semibold border transition-colors',
                  priority === p
                    ? 'bg-dna-500 text-white border-dna-600'
                    : 'text-gray-400 bg-bg-card border-bg-border hover:text-white',
                )}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button type="button" disabled={busy || !title.trim()} onClick={() => void submit()}
            className="btn btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Open case
          </button>
          <button type="button" onClick={onCancel}
            className="btn btn-secondary text-xs">Cancel</button>
        </div>
      </div>
    </SectionCard>
  );
}

function CaseDetail({
  investigationId, onBack,
}: {
  investigationId: string; onBack: () => void;
}) {
  const [c, setCase] = useState<InvestigationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<InvestigationStatus | null>(null);
  const [resolution, setResolution] = useState('');
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const load = useCallback(async () => {
    try {
      setCase(await getInvestigation(investigationId));
    } catch {
      toast.error('Could not load that case');
    } finally {
      setLoading(false);
    }
  }, [investigationId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not record that');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (!c) return null;

  const isClosing = closing !== null;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white">
        <ArrowLeft size={13} /> All investigations
      </button>

      <SectionCard title={c.title} icon={Gavel}>
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              'text-2xs font-semibold rounded-full border px-2 py-0.5',
              STATUS_STYLE[c.status],
            )}>
              {STATUS_LABEL[c.status]}
            </span>
            <span className={cn('text-2xs font-semibold', PRIORITY_STYLE[c.priority])}>
              {c.priority}
            </span>
            <span className="text-2xs text-gray-500 font-mono">{c.caseCode}</span>
            {c.assignee && (
              <span className="text-2xs text-gray-500">Assigned to {c.assignee.name}</span>
            )}
          </div>

          <p className="text-2xs text-gray-500">{c.statusMeaning}</p>

          {c.description !== c.title && (
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{c.description}</p>
          )}

          {c.finding && (
            <div className="rounded-lg border border-bg-border bg-bg-elevated/40 px-2.5 py-2">
              <p className="text-2xs font-semibold text-gray-300 mb-0.5">
                Opened from a confirmed match · {(c.finding.similarity * 100).toFixed(0)}% similar
              </p>
              <a href={c.finding.url} target="_blank" rel="noreferrer noopener"
                className="text-2xs text-dna-400 hover:text-dna-300 inline-flex items-center gap-1">
                <ExternalLink size={10} /> Open source
              </a>
            </div>
          )}

          {c.asset && (
            <p className="text-2xs text-gray-500">
              Asset: <span className="text-gray-300">{c.asset.filename}</span>
              {c.asset.hasDna && ' · fingerprinted'}
              {c.asset.hasVault && ' · vaulted'}
              {c.asset.hasCertificate && ' · certified'}
            </p>
          )}

          {c.resolution && (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
              <p className="text-2xs font-semibold text-emerald-400 mb-0.5">Outcome</p>
              <p className="text-xs text-gray-300 whitespace-pre-wrap">{c.resolution}</p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Lifecycle. Terminal cases show reopen instead — never a status dropdown. */}
      <SectionCard title="Status" icon={ShieldCheck}>
        {c.isTerminal ? (
          reopening ? (
            <div className="space-y-2">
              <label htmlFor="reopen-reason" className="block text-2xs font-semibold text-gray-400">
                Why is this being reopened?
              </label>
              <textarea id="reopen-reason" rows={2} value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="New information, the source reappeared, the client came back."
                className="input w-full text-sm resize-y" />
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy || !reopenReason.trim()}
                  onClick={() => void act(
                    () => updateInvestigation(c.id, { reopenReason: reopenReason.trim() }),
                    'Case reopened',
                  ).then(() => { setReopening(false); setReopenReason(''); })}
                  className="btn btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                  Reopen case
                </button>
                <button type="button" onClick={() => setReopening(false)}
                  className="btn btn-secondary text-xs">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-gray-400">
                This case is closed. Reopening is deliberate and asks for a reason.
              </p>
              <button type="button" onClick={() => setReopening(true)}
                className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
                <RotateCcw size={12} /> Reopen
              </button>
            </div>
          )
        ) : isClosing ? (
          <div className="space-y-2">
            <label htmlFor="case-resolution" className="block text-2xs font-semibold text-gray-400">
              {closing === 'RESOLVED'
                ? 'What was the outcome?'
                : 'Why is this being dismissed? (optional)'}
            </label>
            <textarea id="case-resolution" rows={2} value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="input w-full text-sm resize-y" />
            <div className="flex items-center gap-2">
              <button type="button"
                disabled={busy || (closing === 'RESOLVED' && !resolution.trim())}
                onClick={() => void act(
                  () => updateInvestigation(c.id, {
                    status: closing, resolution: resolution.trim() || undefined,
                  }),
                  closing === 'RESOLVED' ? 'Case resolved' : 'Case dismissed',
                ).then(() => { setClosing(null); setResolution(''); })}
                className="btn btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                {closing === 'RESOLVED' ? 'Resolve case' : 'Dismiss case'}
              </button>
              <button type="button" onClick={() => setClosing(null)}
                className="btn btn-secondary text-xs inline-flex items-center gap-1">
                <X size={12} /> Cancel
              </button>
            </div>
            <p className="text-2xs text-gray-600">
              Closing is final. Reopening later needs a reason and is recorded.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {c.nextStatuses.map((s) => (
              <button key={s} type="button" disabled={busy}
                onClick={() => {
                  if (s === 'RESOLVED' || s === 'DISMISSED') { setClosing(s); return; }
                  void act(() => updateInvestigation(c.id, { status: s }), `Moved to ${STATUS_LABEL[s]}`);
                }}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-2xs font-semibold border transition-colors',
                  'text-gray-300 bg-bg-elevated border-bg-border hover:text-white hover:border-dna-500/40',
                  'disabled:opacity-50',
                )}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Evidence and notes stay apart — one is collected, the other is written. */}
      <CaseEvidencePanel investigationId={c.id} onChanged={() => void load()} />

      {c.campaignId && (
        <CaseReportsPanel
          investigationId={c.id}
          campaignId={c.campaignId}
          evidenceCount={c.evidence.length}
        />
      )}

      <SectionCard title="Case notes" icon={MessageSquare}>
        <div className="space-y-3">
          <ul className="space-y-2">
            {c.timeline.map((t) => (
              <li key={t.id} className={cn(
                'rounded-lg px-2.5 py-2',
                t.isSystem
                  ? 'bg-bg-elevated/40 border border-dashed border-bg-border'
                  : 'bg-bg-card border border-bg-border',
              )}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={cn(
                    'text-2xs font-semibold',
                    t.isSystem ? 'text-gray-500' : 'text-gray-300',
                  )}>
                    {t.author}
                  </span>
                  <span className="text-2xs text-gray-600">{timeAgo(t.at)}</span>
                </div>
                <p className={cn(
                  'text-xs whitespace-pre-wrap',
                  t.isSystem ? 'text-gray-500 italic' : 'text-gray-300',
                )}>
                  {t.body}
                </p>
              </li>
            ))}
          </ul>

          <div className="space-y-2">
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={4000}
              placeholder="What did you check, and what did you find?"
              className="input w-full text-sm resize-y"
              aria-label="Add a case note"
            />
            <button type="button" disabled={busy || !note.trim()}
              onClick={() => void act(
                () => addInvestigationNote(c.id, note.trim()), 'Note added',
              ).then(() => setNote(''))}
              className="btn btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />}
              Add note
            </button>
            <p className="text-2xs text-gray-600">
              A note is your account of what happened — it is not evidence, and is never
              shown to a client as such.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
