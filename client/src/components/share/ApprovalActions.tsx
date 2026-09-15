/**
 * Approve / Request changes, as the client sees them.
 *
 * Approval is deliberately two steps. It is a decision someone may be held to
 * later, so it should not be reachable by a stray click on a phone — the
 * confirmation states plainly what is being agreed to before it is recorded.
 *
 * Requesting changes demands a reason, because a request without one gives the
 * team nothing to act on.
 */
import { useState } from 'react';
import { Check, MessageSquare, ShieldCheck, AlertTriangle, Loader2, X } from 'lucide-react';
import type { ApprovalDecision, VersionDecision } from '../../services/share-review.api';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function ApprovalActions({
  versionNumber, reviewStatus, allowApproval, requiresIdentityCheck,
  decisions, approverName, onDecide,
}: {
  versionNumber: number;
  reviewStatus: string;
  allowApproval: boolean;
  requiresIdentityCheck: boolean;
  decisions: VersionDecision[];
  approverName: string;
  onDecide: (decision: ApprovalDecision, comment: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<ApprovalDecision | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settled = reviewStatus === 'APPROVED';
  const alreadyDecided = decisions.length > 0;

  // A decision already recorded is shown as history, not as something to redo.
  const latest = decisions[0] ?? null;

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDecide(pending, comment.trim());
      setPending(null);
      setComment('');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })
        ?.response?.data?.message
        ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? (err instanceof Error ? err.message : 'Could not record your decision');
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  // ── Already approved ───────────────────────────────────────────────────
  if (settled) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
        <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
          <ShieldCheck size={16} /> Version {versionNumber} approved
        </p>
        {latest && (
          <p className="text-xs text-emerald-700 mt-1">
            By {latest.approverLabel} · {new Date(latest.createdAt).toLocaleString()}
            {latest.identityVerified && ' · identity verified'}
          </p>
        )}
        {latest?.comment && (
          <p className="text-xs text-emerald-800 mt-1.5 italic break-words">“{latest.comment}”</p>
        )}
        <p className="text-2xs text-emerald-700/80 mt-2">
          Any further changes will come to you as a new version.
        </p>
      </div>
    );
  }

  if (!allowApproval) return null;

  // ── Identity gate ──────────────────────────────────────────────────────
  if (requiresIdentityCheck) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
        <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
          <AlertTriangle size={16} /> Verify your identity to sign off
        </p>
        <p className="text-xs text-amber-700 mt-1">
          The sender asked for a verification code before this version can be approved.
          Enter the code you were sent, then come back here.
        </p>
      </div>
    );
  }

  // ── Confirmation ───────────────────────────────────────────────────────
  if (pending) {
    const approving = pending === 'APPROVED';
    return (
      <div className={cn(
        'rounded-xl border px-4 py-3.5',
        approving ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50',
      )}>
        <div className="flex items-start justify-between gap-2">
          <p className={cn('text-sm font-semibold', approving ? 'text-emerald-800' : 'text-amber-800')}>
            {approving ? `Approve version ${versionNumber}?` : `Request changes to version ${versionNumber}?`}
          </p>
          <button type="button" onClick={() => { setPending(null); setError(null); }}
            aria-label="Cancel" className="text-gray-500 hover:text-gray-800 shrink-0">
            <X size={15} />
          </button>
        </div>

        <p className={cn('text-xs mt-1', approving ? 'text-emerald-700' : 'text-amber-700')}>
          {approving
            ? 'This records your acceptance of this version against your name and the time. It cannot be undone — further changes would come to you as a new version.'
            : 'Tell the team what needs changing. They will send a new version when it is ready.'}
        </p>

        <label htmlFor="decision-comment" className="sr-only">
          {approving ? 'Optional note' : 'What needs changing'}
        </label>
        <textarea
          id="decision-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={5000}
          placeholder={approving ? 'Add a note (optional)' : 'What needs changing?'}
          className="w-full mt-2.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                     text-gray-900 placeholder:text-gray-400 resize-y
                     focus:outline-none focus:border-blue-500"
        />

        {error && (
          <p role="alert" className="text-xs text-red-700 mt-2 flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-px" /> {error}
          </p>
        )}

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || (!approving && !comment.trim())}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50',
              approving ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700',
            )}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : approving ? <Check size={14} /> : <MessageSquare size={14} />}
            {busy ? 'Recording…' : approving ? `Approve version ${versionNumber}` : 'Send request'}
          </button>
          <button type="button" onClick={() => { setPending(null); setError(null); }}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
        </div>

        {!approving && !comment.trim() && (
          <p className="text-2xs text-amber-700 mt-1.5">A short reason is needed before this can be sent.</p>
        )}
      </div>
    );
  }

  // ── Resting state ──────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5">
      <p className="text-sm font-semibold text-gray-900">Your decision</p>
      <p className="text-xs text-gray-600 mt-0.5">
        {alreadyDecided
          ? `You last requested changes on this file. Version ${versionNumber} is the latest.`
          : `Approve version ${versionNumber}, or tell the team what needs changing.`}
      </p>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button
          type="button"
          onClick={() => { setPending('APPROVED'); setComment(''); setError(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700
                     px-3.5 py-2 text-sm font-semibold text-white transition-colors"
        >
          <Check size={14} /> Approve
        </button>
        <button
          type="button"
          onClick={() => { setPending('CHANGES_REQUESTED'); setComment(''); setError(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white
                     hover:bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-800 transition-colors"
        >
          <MessageSquare size={14} /> Request changes
        </button>
      </div>
      <p className="text-2xs text-gray-500 mt-2">
        Recorded as {approverName || 'you'}, with the date and time.
      </p>
    </div>
  );
}
