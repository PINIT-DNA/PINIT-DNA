/**
 * The review panel a client sees inside the secure viewer.
 *
 * Renders only when the link is in review mode. On every other share link this
 * component returns null and the viewer looks exactly as it always has — which
 * is what keeps the existing sharing flow untouched.
 *
 * The client sees the version they were given, the conversation on it, and
 * nothing else: no campaign, no other assets, no internal identities.
 */
import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, GitBranch, ShieldCheck, Loader2 } from 'lucide-react';
import type { CommentThreads } from '../../services/business.api';
import type { ClientReviewContext } from '../../services/share-review.api';
import {
  getShareReviewComments, postShareReviewComment,
  getShareReviewDecisions, postShareReviewDecision,
} from '../../services/share-review.api';
import type { VersionDecision } from '../../services/share-review.api';
import { ApprovalActions } from './ApprovalActions';
import { ReviewThreads } from '../business/review/ReviewThreads';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const EMPTY: CommentThreads = { comments: [], counts: { open: 0, resolved: 0, openChangeRequests: 0 } };

const STATUS_COPY: Record<string, { label: string; cls: string }> = {
  DRAFT:             { label: 'Draft',             cls: 'text-gray-600 bg-gray-100 border-gray-200' },
  IN_REVIEW:         { label: 'Review requested',  cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  CHANGES_REQUESTED: { label: 'Changes requested', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  IN_PROGRESS:       { label: 'Being updated',     cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  APPROVED:          { label: 'Approved',          cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  SUPERSEDED:        { label: 'Replaced',          cls: 'text-gray-600 bg-gray-100 border-gray-200' },
};

export function ClientReviewPanel({
  token, review, onActivity,
}: {
  token: string;
  review: ClientReviewContext | null;
  /** Lets the viewer refresh its own header when a status changes. */
  onActivity?: () => void;
}) {
  const [threads, setThreads] = useState<CommentThreads>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [decisions, setDecisions] = useState<VersionDecision[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Decisions are fetched even on a comments-off link, because an approval
      // already recorded must still be shown.
      const [t, d] = await Promise.all([
        review?.allowComments ? getShareReviewComments(token) : Promise.resolve(EMPTY),
        getShareReviewDecisions(token).catch(() => [] as VersionDecision[]),
      ]);
      setThreads(t);
      setDecisions(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load comments');
    } finally {
      setLoading(false);
    }
  }, [token, review?.allowComments]);

  useEffect(() => { void load(); }, [load]);

  if (!review) return null;

  const status = STATUS_COPY[review.reviewStatus] ?? STATUS_COPY.DRAFT;

  return (
    <section
      aria-label="Review"
      className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
    >
      {/* Header — what am I looking at, and what is expected of me */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-gray-200 bg-gray-50/80">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 truncate">{review.filename}</h2>
            <p className="text-xs text-gray-600 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <GitBranch size={12} />
              Version {review.versionNumber}
              {review.versions.length > 1 && (
                <span className="text-gray-500">· {review.versions.length} versions</span>
              )}
            </p>
          </div>
          <span className={cn(
            'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
            status.cls,
          )}>
            {status.label}
          </span>
        </div>

        {review.reviewStatus === 'IN_REVIEW' && review.allowComments && (
          <p className="text-xs text-gray-600 mt-2">
            Your feedback has been requested. Add a comment, or flag something that needs changing.
          </p>
        )}
        {review.reviewStatus === 'CHANGES_REQUESTED' && (
          <p className="text-xs text-amber-700 mt-2">
            Your change request has been sent. You'll see a new version here when it's ready.
          </p>
        )}
        {review.reviewStatus === 'APPROVED' && (
          <p className="text-xs text-emerald-700 mt-2 flex items-center gap-1.5">
            <ShieldCheck size={13} /> This version has been approved.
          </p>
        )}
      </div>

      {/* Version history — visible, but read-only */}
      {review.versions.length > 1 && (
        <div className="px-4 sm:px-5 py-3 border-b border-gray-200">
          <p className="text-2xs font-semibold uppercase tracking-wide text-gray-500 mb-2">History</p>
          <ol className="flex gap-2 overflow-x-auto pb-1">
            {review.versions.map((v) => (
              <li key={v.id}
                className={cn(
                  'shrink-0 rounded-lg border px-2.5 py-1.5 text-xs',
                  v.isCurrent
                    ? 'border-blue-300 bg-blue-50 text-blue-800 font-semibold'
                    : 'border-gray-200 bg-white text-gray-500',
                )}>
                v{v.versionNumber}
                {v.isCurrent && <span className="ml-1 text-2xs">· viewing</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Decision — above the conversation, because it is the thing being asked. */}
      {(review.allowApproval || review.reviewStatus === 'APPROVED') && (
        <div className="px-4 sm:px-5 pt-4">
          <ApprovalActions
            versionNumber={review.versionNumber}
            reviewStatus={review.reviewStatus}
            allowApproval={review.allowApproval}
            requiresIdentityCheck={review.requiresIdentityCheck}
            decisions={decisions}
            approverName={name.trim() || review.recipientLabel}
            onDecide={async (decision, comment) => {
              await postShareReviewDecision(token, {
                decision, comment,
                approverLabel: name.trim() || undefined,
              });
              await load();
              onActivity?.();
            }}
          />
        </div>
      )}

      <div className="px-4 sm:px-5 py-4">
        {!review.allowComments ? (
          <p className="text-xs text-gray-500 text-center py-4">
            This link is view-only. Contact the sender if you need to leave feedback.
          </p>
        ) : (
          <>
            {/* Who is speaking — a client has no account, so ask once. */}
            <div className="mb-3">
              <label htmlFor="client-name" className="block text-2xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Your name <span className="font-normal normal-case tracking-normal">(shown with your comments)</span>
              </label>
              <input
                id="client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder={review.recipientLabel}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900
                           placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            <ClientThreads
              threads={threads}
              loading={loading}
              error={error}
              onRetry={load}
              allowChangeRequest={review.allowChangeRequest}
              onSubmit={async (input) => {
                await postShareReviewComment(token, {
                  ...input,
                  authorLabel: name.trim() || undefined,
                });
                await load();
                onActivity?.();
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Light wrapper so the client never sees resolve controls — resolving is the
 * team's decision, not the requester's.
 */
function ClientThreads({
  threads, loading, error, onRetry, onSubmit, allowChangeRequest,
}: {
  threads: CommentThreads;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  allowChangeRequest: boolean;
  onSubmit: Parameters<typeof ReviewThreads>[0]['onSubmit'];
}) {
  return (
    <div className="client-review-threads">
      <ReviewThreads
        comments={threads.comments}
        counts={threads.counts}
        loading={loading}
        error={error}
        onRetry={onRetry}
        allowChangeRequest={allowChangeRequest}
        onSubmit={allowChangeRequest ? onSubmit : (async (input) => {
          // Belt and braces: the control is hidden above, and the server refuses
          // it anyway, but a forged request still lands as a plain comment.
          await onSubmit?.({ ...input, kind: 'COMMENT' });
        })}
        audience="client"
        emptyHint="Add a comment to start a conversation about this file."
      />
    </div>
  );
}

export function ReviewLoading() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 flex items-center justify-center gap-2 text-sm text-gray-500">
      <Loader2 size={15} className="animate-spin" /> Loading review…
    </div>
  );
}

export { MessageSquare };
