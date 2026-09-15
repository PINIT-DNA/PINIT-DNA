/**
 * Comment and change-request threads for one version.
 *
 * Deliberately presentational and permission-driven: the same component serves
 * the team inside the campaign workspace and the client inside the secure
 * viewer. What differs between them is which callbacks are supplied, not which
 * component renders — so the two audiences can never drift into showing
 * different things about the same thread.
 */
import { useMemo, useState } from 'react';
import {
  MessageSquare, Send, Check, CornerDownRight, AlertTriangle, Loader2, RefreshCw,
} from 'lucide-react';
import type {
  ReviewComment, CommentStatus, CommentKind, CommentAnchor,
} from '../../../services/business.api';
import {
  CommentStatusBadge, KindBadge, AnchorChip, timeAgo, initialsOf,
} from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

type Filter = 'all' | 'open' | 'resolved';

export interface ReviewThreadsProps {
  comments: ReviewComment[];
  counts: { open: number; resolved: number; openChangeRequests: number };
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;

  /** Omit to render read-only — the composer disappears entirely. */
  onSubmit?: (input: { body: string; kind: CommentKind; parentId?: string | null; anchor?: CommentAnchor | null }) => Promise<void>;
  /** Omit to hide resolve/decline controls (clients do not resolve). */
  onSetStatus?: (commentId: string, status: CommentStatus) => Promise<void>;

  /** Shown above the composer, e.g. "Page 4" when the viewer has a selection. */
  pendingAnchor?: CommentAnchor | null;
  onClearAnchor?: () => void;

  /** Copy differs slightly for the client. */
  audience?: 'team' | 'client';
  emptyHint?: string;
  /** False hides the "Needs a change" control — offering a permission the
   *  sender switched off is misleading, even though the server refuses it. */
  allowChangeRequest?: boolean;
}

export function ReviewThreads({
  comments, counts, loading, error, onRetry,
  onSubmit, onSetStatus, pendingAnchor, onClearAnchor,
  audience = 'team', emptyHint, allowChangeRequest = true,
}: ReviewThreadsProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<CommentKind>('COMMENT');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const visible = useMemo(() => comments.filter((c) => {
    if (filter === 'open') return c.status === 'OPEN' || c.status === 'IN_PROGRESS';
    if (filter === 'resolved') return c.status !== 'OPEN' && c.status !== 'IN_PROGRESS';
    return true;
  }), [comments, filter]);

  const submit = async () => {
    const text = body.trim();
    if (!text || !onSubmit || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await onSubmit({
        body: text,
        kind: replyTo ? 'COMMENT' : kind,
        parentId: replyTo,
        anchor: replyTo ? null : pendingAnchor ?? null,
      });
      // Only clear on success, so a failed send never loses what was typed.
      setBody('');
      setKind('COMMENT');
      setReplyTo(null);
      onClearAnchor?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not post — try again');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <ThreadSkeleton />;

  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
        <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
        <p className="text-sm text-white font-semibold mb-1">Couldn't load comments</p>
        <p className="text-xs text-gray-400 mb-3">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry}
            className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters — only worth showing once there is something to filter */}
      {comments.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            ['all', `All ${comments.length}`],
            ['open', `Open ${counts.open}`],
            ['resolved', `Resolved ${counts.resolved}`],
          ] as [Filter, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={cn(
                'px-2.5 py-1 rounded-lg text-2xs font-semibold border transition-colors',
                filter === id
                  ? 'bg-dna-500 text-white border-dna-600'
                  : 'text-gray-400 bg-bg-card border-bg-border hover:text-white hover:border-dna-500/30',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
          <MessageSquare size={20} className="text-gray-500 mx-auto mb-2" />
          <p className="text-sm text-white font-semibold mb-0.5">
            {comments.length === 0 ? 'No comments yet' : `Nothing ${filter}`}
          </p>
          <p className="text-xs text-gray-400">
            {comments.length === 0
              ? emptyHint ?? (audience === 'client'
                ? 'Add a comment to start a conversation about this file.'
                : 'Start a conversation about this version.')
              : 'Try a different filter.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((c) => (
            <Thread
              key={c.id}
              comment={c}
              onSetStatus={onSetStatus}
              onReply={onSubmit ? () => setReplyTo(c.id) : undefined}
              replying={replyTo === c.id}
            />
          ))}
        </ul>
      )}

      {onSubmit && (
        <div className="rounded-xl border border-bg-border bg-bg-card p-3 space-y-2.5">
          {replyTo && (
            <div className="flex items-center justify-between gap-2 text-2xs text-gray-400">
              <span className="inline-flex items-center gap-1.5">
                <CornerDownRight size={12} /> Replying to a thread
              </span>
              <button type="button" onClick={() => setReplyTo(null)}
                className="text-gray-400 hover:text-white font-semibold">Cancel</button>
            </div>
          )}

          {pendingAnchor && !replyTo && (
            <div className="flex items-center justify-between gap-2">
              <AnchorChip anchor={pendingAnchor} />
              {onClearAnchor && (
                <button type="button" onClick={onClearAnchor}
                  className="text-2xs text-gray-400 hover:text-white font-semibold">Clear</button>
              )}
            </div>
          )}

          <label htmlFor="review-composer" className="sr-only">Write a comment</label>
          <textarea
            id="review-composer"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(); }
            }}
            rows={3}
            maxLength={10_000}
            placeholder={replyTo ? 'Write a reply…' : 'Write a comment…'}
            className="w-full bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 text-sm
                       text-white placeholder:text-gray-500 resize-y min-h-[72px]
                       focus:outline-none focus:border-dna-500/60"
          />

          {submitError && (
            <p role="alert" className="text-2xs text-danger flex items-center gap-1.5">
              <AlertTriangle size={12} /> {submitError}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 flex-wrap">
            {!replyTo && allowChangeRequest ? (
              <label className="inline-flex items-center gap-2 text-2xs text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={kind === 'CHANGE_REQUEST'}
                  onChange={(e) => setKind(e.target.checked ? 'CHANGE_REQUEST' : 'COMMENT')}
                  className="accent-amber-500 w-3.5 h-3.5"
                />
                Needs a change
              </label>
            ) : <span />}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={!body.trim() || busy}
              className="btn btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {busy ? 'Sending…' : replyTo ? 'Reply' : kind === 'CHANGE_REQUEST' ? 'Request change' : 'Comment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── One thread ───────────────────────────────────────────────────────────────

function Thread({
  comment, onSetStatus, onReply, replying,
}: {
  comment: ReviewComment;
  onSetStatus?: (id: string, status: CommentStatus) => Promise<void>;
  onReply?: () => void;
  replying?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const settled = comment.status !== 'OPEN' && comment.status !== 'IN_PROGRESS';
  // Resolved threads collapse — an old decision should not crowd out live work.
  const [open, setOpen] = useState(!settled);

  const act = async (status: CommentStatus) => {
    if (!onSetStatus || busy) return;
    setBusy(true);
    try { await onSetStatus(comment.id, status); } finally { setBusy(false); }
  };

  return (
    <li className={cn(
      'rounded-xl border bg-bg-card overflow-hidden transition-colors',
      replying ? 'border-dna-500/50' : 'border-bg-border',
      settled && 'opacity-80',
    )}>
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <Avatar label={comment.authorLabel} isClient={comment.isClient} />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <span className="text-xs font-semibold text-white truncate">{comment.authorLabel}</span>
              {comment.isClient && (
                <span className="text-2xs text-gray-400 border border-bg-border rounded px-1.5 py-px">Client</span>
              )}
              <span className="text-2xs text-gray-500">{timeAgo(comment.createdAt)}</span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              <KindBadge kind={comment.kind} />
              {comment.kind === 'CHANGE_REQUEST' && <CommentStatusBadge status={comment.status} />}
              <AnchorChip anchor={comment.anchor} orphaned={comment.anchorOrphaned} />
            </div>

            {settled && !open ? (
              <button type="button" onClick={() => setOpen(true)}
                className="text-xs text-gray-400 hover:text-white text-left">
                {truncate(comment.body)} <span className="text-dna-400 font-semibold">Show</span>
              </button>
            ) : (
              <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{comment.body}</p>
            )}

            {comment.anchorOrphaned && open && (
              <p className="mt-1.5 text-2xs text-gray-500 italic">
                This pointed at an earlier version, so the exact spot may have moved.
              </p>
            )}

            {open && (
              <div className="flex items-center gap-3 mt-2">
                {onReply && (
                  <button type="button" onClick={onReply}
                    className="text-2xs font-semibold text-gray-400 hover:text-dna-400">
                    Reply
                  </button>
                )}
                {onSetStatus && !settled && (
                  <>
                    <button type="button" disabled={busy} onClick={() => void act('RESOLVED')}
                      className="text-2xs font-semibold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 disabled:opacity-50">
                      <Check size={12} /> Resolve
                    </button>
                    {comment.kind === 'CHANGE_REQUEST' && (
                      <button type="button" disabled={busy} onClick={() => void act('IN_PROGRESS')}
                        className="text-2xs font-semibold text-gray-400 hover:text-white disabled:opacity-50">
                        Mark in progress
                      </button>
                    )}
                  </>
                )}
                {settled && (
                  <button type="button" onClick={() => setOpen(false)}
                    className="text-2xs font-semibold text-gray-500 hover:text-white">Collapse</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {open && comment.replies.length > 0 && (
        <ul className="border-t border-bg-border/70 bg-bg-elevated/30 divide-y divide-bg-border/50">
          {comment.replies.map((r) => (
            <li key={r.id} className="px-3 py-2.5 pl-8">
              <div className="flex items-start gap-2.5">
                <Avatar label={r.authorLabel} isClient={r.isClient} small />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span className="text-2xs font-semibold text-white truncate">{r.authorLabel}</span>
                    {r.isClient && <span className="text-2xs text-gray-500">Client</span>}
                    <span className="text-2xs text-gray-500">{timeAgo(r.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">{r.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Avatar({ label, isClient, small }: { label: string; isClient: boolean; small?: boolean }) {
  return (
    <div className={cn(
      'rounded-full flex items-center justify-center shrink-0 font-bold',
      small ? 'w-5 h-5 text-[9px]' : 'w-7 h-7 text-2xs',
      isClient
        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
        : 'bg-dna-500/15 text-dna-400 border border-dna-500/25',
    )}>
      {initialsOf(label)}
    </div>
  );
}

function truncate(s: string, max = 70): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

function ThreadSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading comments">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl border border-bg-border bg-bg-card p-3">
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-full bg-bg-elevated animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-2.5 w-28 bg-bg-elevated rounded animate-pulse" />
              <div className="h-2.5 w-full bg-bg-elevated rounded animate-pulse" />
              <div className="h-2.5 w-2/3 bg-bg-elevated rounded animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
