/**
 * The version chain for one asset, plus the review-state controls.
 *
 * V1 -> V2 -> V3, newest first. Superseded versions stay listed and stay
 * readable: the whole point of the architecture is that history is never
 * rewritten, so the UI must not hide it either.
 *
 * Only transitions the backend actually allows are offered. APPROVED and
 * SUPERSEDED are terminal, so the panel stops offering actions rather than
 * showing a button that would come back 409.
 */
import { useState } from 'react';
import {
  GitBranch, ShieldCheck, Loader2, Send, Check, MessageSquare, Hammer, FileText,
} from 'lucide-react';
import type { AssetVersion, ReviewStatus } from '../../../services/business.api';
import { ReviewStatusBadge, timeAgo } from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

/** Mirrors ALLOWED_TRANSITIONS in asset-version.service.ts. */
const NEXT_ACTIONS: Partial<Record<ReviewStatus, Array<{
  to: ReviewStatus; label: string; icon: typeof Send; tone: 'primary' | 'ok' | 'warn' | 'plain';
}>>> = {
  DRAFT: [
    { to: 'IN_REVIEW', label: 'Send for review', icon: Send, tone: 'primary' },
  ],
  IN_REVIEW: [
    { to: 'APPROVED', label: 'Approve', icon: Check, tone: 'ok' },
    { to: 'CHANGES_REQUESTED', label: 'Request changes', icon: MessageSquare, tone: 'warn' },
  ],
  CHANGES_REQUESTED: [
    { to: 'IN_PROGRESS', label: 'Start work', icon: Hammer, tone: 'plain' },
    { to: 'IN_REVIEW', label: 'Send for review', icon: Send, tone: 'primary' },
  ],
  IN_PROGRESS: [
    { to: 'IN_REVIEW', label: 'Send for review', icon: Send, tone: 'primary' },
  ],
};

const TONE = {
  primary: 'bg-dna-500 hover:bg-dna-600 text-white border-dna-600',
  ok:      'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700',
  warn:    'bg-amber-600 hover:bg-amber-500 text-white border-amber-700',
  plain:   'bg-bg-elevated hover:bg-bg-card text-gray-300 border-bg-border',
} as const;

export function VersionTimeline({
  versions,
  selectedId,
  onSelect,
  onSetStatus,
  canAct = true,
  busyId,
}: {
  versions: AssetVersion[];
  selectedId?: string | null;
  onSelect?: (v: AssetVersion) => void;
  onSetStatus?: (versionId: string, status: ReviewStatus) => Promise<void>;
  /** False for VIEWER-role members — the controls disappear rather than 403. */
  canAct?: boolean;
  busyId?: string | null;
}) {
  if (versions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
        <GitBranch size={20} className="text-gray-500 mx-auto mb-2" />
        <p className="text-sm font-semibold text-white mb-0.5">No versions yet</p>
        <p className="text-xs text-gray-400">
          Protect a file into this campaign and it becomes version 1.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-2.5">
      {versions.map((v, i) => (
        <VersionRow
          key={v.id}
          version={v}
          isLatest={i === 0}
          selected={selectedId === v.id}
          onSelect={onSelect ? () => onSelect(v) : undefined}
          onSetStatus={onSetStatus}
          canAct={canAct}
          busy={busyId === v.id}
        />
      ))}
    </ol>
  );
}

function VersionRow({
  version: v, isLatest, selected, onSelect, onSetStatus, canAct, busy,
}: {
  version: AssetVersion;
  isLatest: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onSetStatus?: (versionId: string, status: ReviewStatus) => Promise<void>;
  canAct: boolean;
  busy?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const actions = NEXT_ACTIONS[v.reviewStatus] ?? [];
  const superseded = Boolean(v.supersededAt);

  const act = async (to: ReviewStatus) => {
    if (!onSetStatus) return;
    setError(null);
    try { await onSetStatus(v.id, to); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update'); }
  };

  return (
    <li>
      <div
        className={cn(
          'rounded-xl border bg-bg-card transition-colors',
          selected ? 'border-dna-500/60 ring-1 ring-dna-500/20' : 'border-bg-border',
          superseded && 'opacity-75',
        )}
      >
        <div
          className={cn('p-3 flex items-start gap-3', onSelect && 'cursor-pointer')}
          onClick={onSelect}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } } : undefined}
        >
          {/* Version number rail */}
          <div className={cn(
            'shrink-0 w-11 h-11 rounded-xl border flex flex-col items-center justify-center font-bold',
            isLatest && !superseded
              ? 'bg-dna-500/10 border-dna-500/30 text-dna-400'
              : 'bg-bg-elevated border-bg-border text-gray-400',
          )}>
            <span className="text-[9px] leading-none opacity-70">VER</span>
            <span className="text-sm leading-tight tabular-nums">{v.versionNumber}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-white truncate min-w-0" title={v.originalFilename}>
                {v.originalFilename}
              </p>
              <ReviewStatusBadge status={v.reviewStatus} />
            </div>

            <div className="flex items-center gap-2 flex-wrap mt-1 text-2xs text-gray-500">
              <span>{timeAgo(v.createdAt)}</span>
              {v.isProtected ? (
                <span className="inline-flex items-center gap-1 text-emerald-400" title="DNA and vault record exist for this version">
                  <ShieldCheck size={11} /> Protected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-gray-500">
                  <FileText size={11} /> Not protected
                </span>
              )}
              {superseded && <span>· replaced by v{v.versionNumber + 1}</span>}
            </div>

            {v.changeSummary && (
              <p className="text-xs text-gray-400 mt-1.5 break-words">{v.changeSummary}</p>
            )}

            {canAct && onSetStatus && actions.length > 0 && !superseded && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                {actions.map((a) => (
                  <button
                    key={a.to}
                    type="button"
                    disabled={busy}
                    onClick={(e) => { e.stopPropagation(); void act(a.to); }}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-2xs font-semibold transition-colors disabled:opacity-50',
                      TONE[a.tone],
                    )}
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <a.icon size={12} />}
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            {v.reviewStatus === 'APPROVED' && (
              <p className="text-2xs text-emerald-400/80 mt-2 flex items-center gap-1.5">
                <Check size={11} /> Approved — create a new version to make further changes.
              </p>
            )}

            {error && <p role="alert" className="text-2xs text-danger mt-2">{error}</p>}
          </div>
        </div>
      </div>
    </li>
  );
}
