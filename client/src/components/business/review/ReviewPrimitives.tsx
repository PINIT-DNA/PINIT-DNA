/**
 * Shared review vocabulary — status badges and small pieces used by both the
 * team's campaign workspace and the client's secure viewer.
 *
 * Kept in one place so a version that reads "Changes requested" to the team
 * never reads as something else to the client.
 *
 * Colour is semantic here, not decorative: amber means someone must act,
 * emerald means settled, blue means in flight, grey means historical. That is
 * separate from the dna-blue brand accent used for navigation.
 */
import { CheckCircle2, Clock, GitBranch, MessageSquare, PenLine, Archive } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReviewStatus, CommentStatus, CommentKind, CommentAnchor } from '../../../services/business.api';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

// ── Version review status ────────────────────────────────────────────────────

const REVIEW_STATUS: Record<ReviewStatus, { label: string; cls: string; icon: LucideIcon }> = {
  DRAFT:             { label: 'Draft',             cls: 'text-gray-400 bg-bg-elevated border-bg-border',                 icon: PenLine },
  IN_REVIEW:         { label: 'In review',         cls: 'text-dna-400 bg-dna-500/10 border-dna-500/25',                  icon: Clock },
  CHANGES_REQUESTED: { label: 'Changes requested', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30',            icon: MessageSquare },
  IN_PROGRESS:       { label: 'In progress',       cls: 'text-dna-400 bg-dna-500/10 border-dna-500/25',                  icon: GitBranch },
  APPROVED:          { label: 'Approved',          cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',      icon: CheckCircle2 },
  SUPERSEDED:        { label: 'Superseded',        cls: 'text-gray-500 bg-bg-elevated/60 border-bg-border',              icon: Archive },
};

export function ReviewStatusBadge({ status, size = 'sm' }: { status: ReviewStatus; size?: 'sm' | 'md' }) {
  const s = REVIEW_STATUS[status] ?? REVIEW_STATUS.DRAFT;
  const Icon = s.icon;
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap',
      size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-2xs',
      s.cls,
    )}>
      <Icon size={size === 'md' ? 13 : 11} className="shrink-0" />
      {s.label}
    </span>
  );
}

export function reviewStatusLabel(status: ReviewStatus): string {
  return REVIEW_STATUS[status]?.label ?? status;
}

// ── Comment / change-request status ──────────────────────────────────────────

const COMMENT_STATUS: Record<CommentStatus, { label: string; cls: string }> = {
  OPEN:        { label: 'Open',        cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  IN_PROGRESS: { label: 'In progress', cls: 'text-dna-400 bg-dna-500/10 border-dna-500/25' },
  RESOLVED:    { label: 'Resolved',    cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  REJECTED:    { label: 'Declined',    cls: 'text-gray-400 bg-bg-elevated border-bg-border' },
  CLOSED:      { label: 'Closed',      cls: 'text-gray-400 bg-bg-elevated border-bg-border' },
};

export function CommentStatusBadge({ status }: { status: CommentStatus }) {
  const s = COMMENT_STATUS[status] ?? COMMENT_STATUS.OPEN;
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-semibold whitespace-nowrap',
      s.cls,
    )}>
      {s.label}
    </span>
  );
}

export function KindBadge({ kind }: { kind: CommentKind }) {
  if (kind !== 'CHANGE_REQUEST') return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10
                     px-2 py-0.5 text-2xs font-semibold text-amber-400 whitespace-nowrap">
      <MessageSquare size={10} /> Change request
    </span>
  );
}

// ── Anchors ──────────────────────────────────────────────────────────────────

/** Human-readable location for a comment, e.g. "Page 4" or "02:34". */
export function describeAnchor(anchor: CommentAnchor | null): string | null {
  if (!anchor) return null;
  switch (anchor.type) {
    case 'page':
      return `Page ${anchor.page}`;
    case 'coordinate':
      return 'Pinned on image';
    case 'timestamp': {
      const total = Math.floor(anchor.seconds);
      const m = String(Math.floor(total / 60)).padStart(2, '0');
      const s = String(total % 60).padStart(2, '0');
      return `${m}:${s}`;
    }
    case 'text':
      return anchor.page ? `Page ${anchor.page} · “${trim(anchor.quote)}”` : `“${trim(anchor.quote)}”`;
    default:
      return null;
  }
}

function trim(q: string, max = 40): string {
  return q.length > max ? `${q.slice(0, max - 1)}…` : q;
}

/** Small inline chip showing where a comment points. */
export function AnchorChip({ anchor, orphaned }: { anchor: CommentAnchor | null; orphaned?: boolean }) {
  const text = describeAnchor(anchor);
  if (!text) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium mono',
        orphaned
          ? 'text-gray-500 border-bg-border bg-bg-elevated/60 line-through decoration-1'
          : 'text-gray-400 border-bg-border bg-bg-elevated',
      )}
      title={orphaned
        ? 'This location was from an earlier version and may no longer match'
        : text}
    >
      {text}
    </span>
  );
}

/** Relative time that degrades gracefully — never shows "Invalid Date". */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase() || '?';
}
