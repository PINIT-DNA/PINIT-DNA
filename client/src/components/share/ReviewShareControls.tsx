/**
 * Review permissions for a secure link, inside the existing share dialog.
 *
 * The whole point is that the sender knows exactly what the recipient will be
 * able to do before the link exists. So each toggle states its consequence in
 * the recipient's terms, and the summary line at the bottom reads back the
 * resulting permission set as one sentence.
 *
 * Review is off by default. A link created without touching this section
 * behaves exactly as share links always have.
 */
import { MessageSquare, PenLine, ShieldCheck, Eye, Info, Loader2 } from 'lucide-react';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export interface ReviewPermissions {
  reviewMode: boolean;
  allowComments: boolean;
  allowChangeRequest: boolean;
  allowApproval: boolean;
}

export interface ReviewEligibility {
  eligible: boolean;
  reason?: string;
  campaignName?: string | null;
  clientName?: string | null;
  versionCount?: number;
}

export function ReviewShareControls({
  value, onChange, eligibility, loading, required,
}: {
  value: ReviewPermissions;
  onChange: (next: ReviewPermissions) => void;
  eligibility: ReviewEligibility | null;
  loading: boolean;
  /** Campaign "Generate review link" — review stays on; a view-only link would be the wrong product. */
  required?: boolean;
}) {
  const set = (patch: Partial<ReviewPermissions>) => {
    const next = { ...value, ...patch };
    // Turning review off clears everything under it, so a link can never carry
    // a stray grant that the sender thinks is switched off.
    if (!next.reviewMode) {
      next.allowComments = false;
      next.allowChangeRequest = false;
      next.allowApproval = false;
    }
    // A change request or an approval is meaningless without the conversation
    // around it, so enabling either turns comments on.
    if ((next.allowChangeRequest || next.allowApproval) && !next.allowComments) {
      next.allowComments = true;
    }
    onChange(next);
  };

  if (loading) {
    return (
      <div className="border border-bg-border rounded-xl px-3 py-3 flex items-center gap-2 text-2xs text-gray-500">
        <Loader2 size={13} className="animate-spin" /> Checking whether this file can be reviewed…
      </div>
    );
  }

  // Not a campaign asset — say why, rather than showing controls that would fail.
  if (eligibility && !eligibility.eligible) {
    return (
      <div className="border border-bg-border rounded-xl px-3 py-3 bg-bg-elevated/40">
        <p className="text-xs font-semibold text-gray-300 flex items-center gap-2">
          <MessageSquare size={13} /> Client review
        </p>
        <p className="text-2xs text-gray-500 mt-1 flex items-start gap-1.5">
          <Info size={11} className="shrink-0 mt-0.5" />
          {eligibility.reason ?? 'Review is not available for this file.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-300">Review</p>
        {eligibility?.campaignName && (
          <p className="text-2xs text-gray-500 truncate max-w-[60%]" title={eligibility.campaignName}>
            {eligibility.clientName ? `${eligibility.clientName} · ` : ''}{eligibility.campaignName}
          </p>
        )}
      </div>

      {/* Master switch */}
      <button
        type="button"
        onClick={() => {
          if (required && value.reviewMode) return;
          set({ reviewMode: !value.reviewMode, allowComments: !value.reviewMode });
        }}
        aria-pressed={value.reviewMode}
        disabled={Boolean(required && value.reviewMode)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors',
          value.reviewMode
            ? 'border-dna-500/40 bg-dna-500/10'
            : 'border-bg-border bg-bg-elevated hover:border-dna-500/25',
          required && value.reviewMode && 'cursor-default',
        )}
      >
        <div className="min-w-0 pr-3">
          <p className={cn('text-xs font-semibold flex items-center gap-2',
            value.reviewMode ? 'text-dna-400' : 'text-gray-300')}>
            <MessageSquare size={12} />
            Turn this into a review link
            <span className={cn('text-2xs px-1.5 py-0.5 rounded font-bold',
              value.reviewMode ? 'bg-dna-500/20 text-dna-400' : 'bg-bg-border text-gray-500')}>
              {value.reviewMode ? 'ON' : 'OFF'}
            </span>
          </p>
          <p className="text-2xs text-gray-500 mt-0.5">
            {required
              ? 'Required for a campaign client review link. The recipient is not added to your team.'
              : value.reviewMode
                ? 'The recipient sees the current version and can give feedback.'
                : 'Off — the recipient can only view the file.'}
          </p>
        </div>
        <div className={cn('w-8 h-4 rounded-full relative shrink-0',
          value.reviewMode ? 'bg-dna-500' : 'bg-bg-border')}>
          <div className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all',
            value.reviewMode ? 'left-4' : 'left-0.5')} />
        </div>
      </button>

      {value.reviewMode && (
        <div className="pl-2 border-l-2 border-dna-500/25 ml-1 space-y-1.5">
          <Permission
            icon={MessageSquare}
            label="Allow comments"
            detail="They can write notes on this version, and see your replies."
            checked={value.allowComments}
            onToggle={() => set({ allowComments: !value.allowComments })}
            // Comments underpin the other two, so it cannot be turned off beneath them.
            locked={value.allowChangeRequest || value.allowApproval}
            lockedHint="Needed for change requests and approval."
          />
          <Permission
            icon={PenLine}
            label="Allow change requests"
            detail="They can formally ask for changes, which appears in your Approvals queue."
            checked={value.allowChangeRequest}
            onToggle={() => set({ allowChangeRequest: !value.allowChangeRequest })}
          />
          <Permission
            icon={ShieldCheck}
            label="Allow approval"
            detail="They can sign this version off. The decision is recorded against their name and cannot be undone."
            checked={value.allowApproval}
            onToggle={() => set({ allowApproval: !value.allowApproval })}
            emphasis
          />
        </div>
      )}

      <SummaryLine value={value} />
    </div>
  );
}

function Permission({
  icon: Icon, label, detail, checked, onToggle, locked, lockedHint, emphasis,
}: {
  icon: typeof MessageSquare;
  label: string;
  detail: string;
  checked: boolean;
  onToggle: () => void;
  locked?: boolean;
  lockedHint?: string;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => { if (!locked) onToggle(); }}
      aria-pressed={checked}
      disabled={locked}
      className={cn(
        'w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-colors',
        checked
          ? emphasis
            ? 'border-emerald-500/35 bg-emerald-500/10'
            : 'border-dna-500/30 bg-dna-500/5'
          : 'border-bg-border bg-bg-elevated hover:border-dna-500/20',
        locked && 'opacity-70 cursor-default',
      )}
    >
      <span className={cn(
        'mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0',
        checked
          ? emphasis ? 'bg-emerald-500 border-emerald-600' : 'bg-dna-500 border-dna-600'
          : 'border-bg-border bg-bg-card',
      )}>
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="min-w-0">
        <span className={cn('text-2xs font-semibold flex items-center gap-1.5',
          checked ? (emphasis ? 'text-emerald-400' : 'text-dna-400') : 'text-gray-300')}>
          <Icon size={11} /> {label}
        </span>
        <span className="block text-2xs text-gray-500 mt-0.5">
          {locked && lockedHint ? lockedHint : detail}
        </span>
      </span>
    </button>
  );
}

/** Reads the permission set back as one sentence, in the recipient's terms. */
function SummaryLine({ value }: { value: ReviewPermissions }) {
  const can: string[] = ['open the file'];
  if (value.reviewMode && value.allowComments) can.push('comment');
  if (value.reviewMode && value.allowChangeRequest) can.push('request changes');
  if (value.reviewMode && value.allowApproval) can.push('approve this version');

  const sentence = can.length === 1
    ? can[0]
    : `${can.slice(0, -1).join(', ')} and ${can[can.length - 1]}`;

  return (
    <p className="text-2xs text-gray-400 flex items-start gap-1.5 px-1 pt-1">
      <Eye size={11} className="shrink-0 mt-0.5 text-gray-500" />
      <span>The recipient will be able to <span className="text-gray-200 font-medium">{sentence}</span>.</span>
    </p>
  );
}
