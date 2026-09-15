/**
 * Campaign → Handover.
 *
 * Handing work over is a deliberate act with a record, so the flow is
 * select → review → confirm rather than a single button. The review step
 * restates exactly what the client will receive, because that is the last
 * moment anyone can catch the wrong file going out.
 *
 * Assets that are not approved are listed and disabled rather than hidden:
 * "why can I not send this one" is the first question, and an absent row
 * cannot answer it.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  PackageCheck, Send, Copy, ShieldOff, AlertTriangle, RefreshCw, Loader2,
  Check, Clock, Eye, ChevronLeft, Archive, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listHandoverCandidates, listHandovers, createHandover, sendHandover, revokeHandover,
} from '../../../services/business.api';
import type {
  HandoverCandidates, Handover, HandoverStatus, HandoverCandidate,
} from '../../../services/business.api';
import { SectionCard, SkeletonRows } from '../clients/BusinessKit';
import { timeAgo } from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const STATUS: Record<HandoverStatus, { label: string; cls: string; icon: typeof Clock }> = {
  DRAFT:     { label: 'Draft',      cls: 'text-gray-400 bg-bg-elevated border-bg-border',              icon: Clock },
  READY:     { label: 'Sent',       cls: 'text-dna-400 bg-dna-500/10 border-dna-500/25',               icon: Send },
  COMPLETED: { label: 'Received',   cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',   icon: Check },
  REVOKED:   { label: 'Withdrawn',  cls: 'text-gray-500 bg-bg-elevated/60 border-bg-border',           icon: ShieldOff },
};

type Step = 'list' | 'select' | 'review';

export function HandoverPanel({
  campaignId, onChanged,
}: {
  campaignId: string;
  onChanged?: () => void;
}) {
  const [step, setStep] = useState<Step>('list');
  const [cands, setCands] = useState<HandoverCandidates | null>(null);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [recipient, setRecipient] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, h] = await Promise.all([
        listHandoverCandidates(campaignId),
        listHandovers(campaignId),
      ]);
      setCands(c);
      setHandovers(h);
      if (!recipient && c.client) setRecipient(c.client.contactName ?? c.client.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load handovers');
    } finally {
      setLoading(false);
    }
    // `recipient` deliberately omitted: prefilling once must not overwrite typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const eligible = cands?.candidates.filter((c) => c.eligible) ?? [];
  const blocked = cands?.candidates.filter((c) => !c.eligible) ?? [];
  const chosen = eligible.filter((c) => selected.includes(c.assetId));

  const reset = () => { setSelected([]); setNote(''); setStepError(null); setStep('list'); };

  const confirm = async () => {
    setBusy(true);
    setStepError(null);
    try {
      const created = await createHandover(campaignId, {
        assetIds: selected,
        note: note.trim() || undefined,
        recipientLabel: recipient.trim() || undefined,
        allowDownload,
      });
      await sendHandover(campaignId, created.id);
      toast.success('Handover sent');
      reset();
      await load();
      onChanged?.();
    } catch (err) {
      setStepError((err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (err instanceof Error ? err.message : 'Could not create the handover'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <SkeletonRows rows={4} />;

  if (error) {
    return (
      <SectionCard title="Handover" icon={PackageCheck}>
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
          <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Couldn't load handovers</p>
          <p className="text-xs text-gray-400 mb-3">{error}</p>
          <button type="button" onClick={load}
            className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      </SectionCard>
    );
  }

  // ── Step 2: review before sending ──────────────────────────────────────
  if (step === 'review') {
    return (
      <SectionCard title="Review handover" icon={PackageCheck}>
        <button type="button" onClick={() => setStep('select')}
          className="text-2xs font-semibold text-gray-400 hover:text-white inline-flex items-center gap-1 mb-3">
          <ChevronLeft size={12} /> Back to selection
        </button>

        <p className="text-sm text-white font-semibold mb-1">
          {recipient || cands?.client?.name || 'The client'} will receive {chosen.length} final
          asset{chosen.length === 1 ? '' : 's'}
        </p>
        <p className="text-2xs text-gray-500 mb-3">
          They open a handover page — not your Business Account. It shows only these files, the
          version each was approved at, and their certificates.
        </p>

        <ul className="space-y-1.5 mb-3">
          {chosen.map((c) => (
            <li key={c.assetId}
              className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25
                         bg-emerald-500/5 px-3 py-2">
              <span className="text-xs text-gray-200 truncate flex items-center gap-1.5 min-w-0">
                <Check size={11} className="text-emerald-400 shrink-0" />
                <span className="truncate">{c.filename}</span>
              </span>
              <span className="text-2xs text-gray-500 shrink-0">
                approved v{c.versionNumber}
              </span>
            </li>
          ))}
        </ul>

        <div className="space-y-2.5">
          <div>
            <label htmlFor="ho-recipient" className="block text-2xs text-gray-500 uppercase tracking-wide mb-1">
              Recipient name
            </label>
            <input
              id="ho-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              maxLength={120}
              placeholder={cands?.client?.name ?? 'Client'}
              className="w-full bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 text-sm
                         text-white placeholder:text-gray-500 focus:outline-none focus:border-dna-500/60"
            />
            <p className="text-2xs text-gray-500 mt-1">Recorded on the handover as who received it.</p>
          </div>

          <div>
            <label htmlFor="ho-note" className="block text-2xs text-gray-500 uppercase tracking-wide mb-1">
              Message (optional)
            </label>
            <textarea
              id="ho-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Anything they should know…"
              className="w-full bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 text-sm
                         text-white placeholder:text-gray-500 resize-y focus:outline-none focus:border-dna-500/60"
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)}
              className="accent-dna-500 w-3.5 h-3.5 mt-0.5" />
            <span>
              <span className="block text-2xs text-gray-300">Allow download</span>
              <span className="block text-2xs text-gray-500">
                Final delivery usually means they keep a copy.
              </span>
            </span>
          </label>
        </div>

        {stepError && (
          <p role="alert" className="text-2xs text-danger mt-3 flex items-start gap-1.5">
            <AlertTriangle size={11} className="shrink-0 mt-px" /> {stepError}
          </p>
        )}

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <button type="button" disabled={busy} onClick={() => void confirm()}
            className="btn btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {busy ? 'Sending…' : 'Confirm and send handover'}
          </button>
          <button type="button" onClick={reset}
            className="btn btn-secondary text-xs">Cancel</button>
        </div>
      </SectionCard>
    );
  }

  // ── Step 1: choose assets ──────────────────────────────────────────────
  if (step === 'select') {
    return (
      <SectionCard title="Select final assets" icon={PackageCheck}>
        <button type="button" onClick={reset}
          className="text-2xs font-semibold text-gray-400 hover:text-white inline-flex items-center gap-1 mb-3">
          <ChevronLeft size={12} /> Back
        </button>

        {eligible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
            <PackageCheck size={20} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white mb-0.5">Nothing is approved yet</p>
            <p className="text-xs text-gray-400">
              Only an approved version can be handed over. Get a version approved first.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {eligible.map((c) => (
              <li key={c.assetId}>
                <label className="flex items-center gap-2.5 rounded-lg border border-bg-border
                                  bg-bg-elevated/40 px-3 py-2.5 cursor-pointer hover:border-dna-500/30">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.assetId)}
                    onChange={(e) => setSelected(e.target.checked
                      ? [...selected, c.assetId]
                      : selected.filter((x) => x !== c.assetId))}
                    className="accent-dna-500 w-4 h-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-white truncate">{c.filename}</span>
                    <span className="block text-2xs text-emerald-400">
                      Approved · version {c.versionNumber}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {blocked.length > 0 && <BlockedList items={blocked} />}

        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => setStep('review')}
          className="btn btn-primary text-xs mt-3 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          Review {selected.length || 'no'} asset{selected.length === 1 ? '' : 's'}
        </button>
      </SectionCard>
    );
  }

  // ── Step 0: history + start ────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <SectionCard
        title="Handover"
        icon={PackageCheck}
        action={
          <button type="button" onClick={() => setStep('select')}
            className="btn btn-primary text-2xs inline-flex items-center gap-1.5">
            <Send size={12} /> New handover
          </button>
        }
      >
        {handovers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
            <PackageCheck size={20} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white mb-0.5">Nothing handed over yet</p>
            <p className="text-xs text-gray-400">
              {eligible.length > 0
                ? `${eligible.length} approved asset${eligible.length === 1 ? ' is' : 's are'} ready to hand over.`
                : 'Approved assets will become available here.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {handovers.map((h) => (
              <HandoverRow key={h.id} handover={h} campaignId={campaignId}
                onChanged={() => { void load(); onChanged?.(); }} />
            ))}
          </ul>
        )}
      </SectionCard>

      {blocked.length > 0 && handovers.length === 0 && (
        <SectionCard title="Not ready yet" icon={Info}>
          <BlockedList items={blocked} />
        </SectionCard>
      )}
    </div>
  );
}

function BlockedList({ items }: { items: HandoverCandidate[] }) {
  return (
    <div className="mt-3">
      <p className="text-2xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
        Cannot be handed over yet
      </p>
      <ul className="space-y-1.5">
        {items.map((c) => (
          <li key={c.assetId}
            className="rounded-lg border border-bg-border bg-bg-elevated/30 px-3 py-2 opacity-80">
            <p className="text-xs text-gray-400 truncate flex items-center gap-1.5">
              <Archive size={11} className="shrink-0 text-gray-500" />
              <span className="truncate">{c.filename}</span>
            </p>
            <p className="text-2xs text-amber-400/80 mt-0.5">{c.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HandoverRow({
  handover: h, campaignId, onChanged,
}: {
  handover: Handover; campaignId: string; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const s = STATUS[h.status] ?? STATUS.DRAFT;
  const Icon = s.icon;
  const url = `${window.location.origin}/handover/${h.accessToken}`;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast.success(msg); onChanged(); }
    catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Something went wrong');
    } finally { setBusy(false); }
  };

  return (
    <li className="rounded-xl border border-bg-border bg-bg-card p-3">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {h.title ?? 'Final assets'}
          </p>
          <p className="text-2xs text-gray-500">
            To {h.recipientLabel} · {h.assets.length} asset{h.assets.length === 1 ? '' : 's'}
            {h.sentAt && ` · sent ${timeAgo(h.sentAt)}`}
          </p>
        </div>
        <span className={cn('text-2xs font-semibold rounded-full border px-2 py-0.5 inline-flex items-center gap-1 whitespace-nowrap', s.cls)}>
          <Icon size={10} /> {s.label}
        </span>
      </div>

      <ul className="space-y-1 mb-2">
        {h.assets.map((a) => (
          <li key={a.assetId} className="text-2xs text-gray-400 truncate">· {a.filename}</li>
        ))}
      </ul>

      {h.firstOpenedAt && (
        <p className="text-2xs text-emerald-400 flex items-center gap-1.5 mb-2">
          <Eye size={10} /> Opened {timeAgo(h.firstOpenedAt)}
          {h.openCount > 1 && ` · ${h.openCount} times`}
        </p>
      )}

      {h.status !== 'REVOKED' && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(url)
                .then(() => toast.success('Handover link copied'))
                .catch(() => toast.error('Could not copy'));
            }}
            className="text-2xs font-semibold text-dna-400 hover:text-dna-300 inline-flex items-center gap-1"
          >
            <Copy size={11} /> Copy link
          </button>

          {h.status === 'DRAFT' && (
            <button type="button" disabled={busy}
              onClick={() => void act(() => sendHandover(campaignId, h.id), 'Handover sent')}
              className="text-2xs font-semibold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 disabled:opacity-50">
              <Send size={11} /> Send
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Withdraw this handover? ${h.recipientLabel} loses access immediately.`)) return;
              void act(() => revokeHandover(campaignId, h.id), 'Handover withdrawn');
            }}
            className="text-2xs font-semibold text-gray-500 hover:text-danger inline-flex items-center gap-1 disabled:opacity-50"
          >
            <ShieldOff size={11} /> Withdraw
          </button>
        </div>
      )}

      {h.status === 'REVOKED' && (
        <p className="text-2xs text-gray-500">
          Withdrawn {h.revokedAt ? timeAgo(h.revokedAt) : ''} — the links no longer work.
        </p>
      )}
    </li>
  );
}
