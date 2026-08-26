/**
 * The Versions and Approvals tabs of the campaign workspace.
 *
 * Both read live data — there is no placeholder content here. An asset with no
 * versions yet adopts itself as V1 the first time the API is asked for its
 * chain, so the panel is never empty for an asset that exists.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, MessageSquare, Archive, AlertTriangle, RefreshCw, Loader2, Inbox, ShieldCheck, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listAssetVersions, setVersionReviewStatus,
  listVersionComments, createVersionComment, setCommentStatus,
  listCampaignChangeRequests, listCampaignApprovals,
  listCampaignMessages, sendCampaignMessage, markCampaignMessagesRead, campaignMessageStreamUrl,
} from '../../../services/business.api';
import type {
  CampaignAsset, AssetVersion, ReviewStatus,
  ReviewComment, CommentThreads, VersionApproval, CampaignMessage,
} from '../../../services/business.api';
import { SectionCard, SkeletonRows } from '../clients/BusinessKit';
import { VersionTimeline } from './VersionTimeline';
import { ReviewThreads } from './ReviewThreads';
import { ConversationPanel } from './ConversationPanel';
import { ReviewStatusBadge, CommentStatusBadge, AnchorChip, timeAgo } from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const EMPTY_THREADS: CommentThreads = { comments: [], counts: { open: 0, resolved: 0, openChangeRequests: 0 } };

// ── Versions tab ─────────────────────────────────────────────────────────────

export function VersionsPanel({
  assets, assetsLoading, onChanged,
}: {
  assets: CampaignAsset[] | null;
  assetsLoading: boolean;
  onChanged?: () => void;
}) {
  const [assetId, setAssetId] = useState<string | null>(null);
  const [versions, setVersions] = useState<AssetVersion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [threads, setThreads] = useState<CommentThreads>(EMPTY_THREADS);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  // Default to the first asset once they arrive, without clobbering a choice.
  useEffect(() => {
    if (!assetId && assets && assets.length > 0) setAssetId(assets[0].id);
  }, [assets, assetId]);

  const loadVersions = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAssetVersions(id);
      setVersions(res.versions);
      setSelectedVersionId((prev) =>
        prev && res.versions.some((v) => v.id === prev) ? prev : res.currentVersionId,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load versions');
      setVersions(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (assetId) void loadVersions(assetId); }, [assetId, loadVersions]);

  const loadThreads = useCallback(async (versionId: string) => {
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      setThreads(await listVersionComments(versionId));
    } catch (err) {
      setThreadsError(err instanceof Error ? err.message : 'Could not load comments');
      setThreads(EMPTY_THREADS);
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedVersionId) void loadThreads(selectedVersionId);
    else setThreads(EMPTY_THREADS);
  }, [selectedVersionId, loadThreads]);

  const handleStatus = useCallback(async (versionId: string, status: ReviewStatus) => {
    setBusyId(versionId);
    try {
      await setVersionReviewStatus(versionId, status);
      toast.success('Version updated');
      if (assetId) await loadVersions(assetId);
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }, [assetId, loadVersions, onChanged]);

  const selected = useMemo(
    () => versions?.find((v) => v.id === selectedVersionId) ?? null,
    [versions, selectedVersionId],
  );

  if (assetsLoading) return <SkeletonRows rows={3} />;

  if (!assets || assets.length === 0) {
    return (
      <SectionCard title="Versions" icon={GitBranch}>
        <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
          <Archive size={20} className="text-gray-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-0.5">No assets in this campaign yet</p>
          <p className="text-xs text-gray-400">Protect an asset to start its version history.</p>
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      <div className="lg:col-span-3 space-y-4">
        <SectionCard title="Versions" icon={GitBranch}>
          {/* Asset picker — only when there is a choice to make */}
          {assets.length > 1 && (
            <div className="mb-3">
              <label htmlFor="version-asset" className="block text-2xs text-gray-500 uppercase tracking-wide mb-1.5">
                Asset
              </label>
              <select
                id="version-asset"
                value={assetId ?? ''}
                onChange={(e) => { setAssetId(e.target.value); setSelectedVersionId(null); }}
                className="w-full bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 text-sm text-white
                           focus:outline-none focus:border-dna-500/60"
              >
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{a.originalFilename}</option>
                ))}
              </select>
            </div>
          )}

          {loading ? (
            <SkeletonRows rows={2} />
          ) : error ? (
            <ErrorBlock message={error} onRetry={() => assetId && void loadVersions(assetId)} />
          ) : (
            <VersionTimeline
              versions={versions ?? []}
              selectedId={selectedVersionId}
              onSelect={(v) => setSelectedVersionId(v.id)}
              onSetStatus={handleStatus}
              busyId={busyId}
            />
          )}
        </SectionCard>
      </div>

      <div className="lg:col-span-2 space-y-4">
        <SectionCard
          title={selected ? `Comments · v${selected.versionNumber}` : 'Comments'}
          icon={MessageSquare}
          action={selected ? <ReviewStatusBadge status={selected.reviewStatus} /> : undefined}
        >
          {!selected ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Select a version to see its comments.
            </p>
          ) : (
            <ReviewThreads
              comments={threads.comments}
              counts={threads.counts}
              loading={threadsLoading}
              error={threadsError}
              onRetry={() => void loadThreads(selected.id)}
              onSubmit={async (input) => {
                await createVersionComment(selected.id, input);
                await loadThreads(selected.id);
                onChanged?.();
              }}
              onSetStatus={async (id, status) => {
                await setCommentStatus(id, status);
                await loadThreads(selected.id);
                onChanged?.();
              }}
              emptyHint="Comments here are tied to this version, so they stay meaningful when a new one lands."
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// ── Approvals tab ────────────────────────────────────────────────────────────

export function ApprovalsPanel({
  campaignId, assets, onChanged,
}: {
  campaignId: string;
  assets: CampaignAsset[] | null;
  onChanged?: () => void;
}) {
  const [requests, setRequests] = useState<ReviewComment[] | null>(null);
  const [decisions, setDecisions] = useState<VersionApproval[]>([]);
  const [awaiting, setAwaiting] = useState<Array<{ asset: CampaignAsset; version: AssetVersion }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [crs, decided, chains] = await Promise.all([
        listCampaignChangeRequests(campaignId),
        listCampaignApprovals(campaignId).catch(() => [] as VersionApproval[]),
        Promise.all((assets ?? []).map(async (a) => ({ asset: a, chain: await listAssetVersions(a.id) }))),
      ]);
      setRequests(crs);
      setDecisions(decided);
      // Anything not yet settled needs someone's attention.
      setAwaiting(
        chains.flatMap(({ asset, chain }) => chain.versions
          .filter((v) => v.reviewStatus === 'IN_REVIEW' || v.reviewStatus === 'CHANGES_REQUESTED')
          .map((version) => ({ asset, version }))),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load approvals');
    } finally {
      setLoading(false);
    }
  }, [campaignId, assets]);

  useEffect(() => { void load(); }, [load]);

  const resolve = async (id: string) => {
    setBusy(id);
    try {
      await setCommentStatus(id, 'RESOLVED');
      toast.success('Marked resolved');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <SkeletonRows rows={4} />;
  if (error) {
    return <SectionCard title="Approvals"><ErrorBlock message={error} onRetry={load} /></SectionCard>;
  }

  const openRequests = requests ?? [];
  const nothingPending = openRequests.length === 0 && awaiting.length === 0 && decisions.length === 0;

  if (nothingPending) {
    return (
      <SectionCard title="Approvals" icon={Inbox}>
        <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
          <Inbox size={20} className="text-gray-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-0.5">Nothing waiting</p>
          <p className="text-xs text-gray-400">
            No open change requests, and no version is currently in review.
          </p>
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      {awaiting.length > 0 && (
        <SectionCard title={`In review · ${awaiting.length}`} icon={GitBranch}>
          <ul className="space-y-2">
            {awaiting.map(({ asset, version }) => (
              <li key={version.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-bg-border bg-bg-elevated/40 px-3 py-2.5 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{asset.originalFilename}</p>
                  <p className="text-2xs text-gray-500 mt-0.5">
                    Version {version.versionNumber} · updated {timeAgo(version.createdAt)}
                  </p>
                </div>
                <ReviewStatusBadge status={version.reviewStatus} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {decisions.length > 0 && (
        <SectionCard title="Decisions" icon={ShieldCheck}>
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={d.id}
                className={cn(
                  'rounded-lg border px-3 py-2.5',
                  d.decision === 'APPROVED'
                    ? 'border-emerald-500/25 bg-emerald-500/5'
                    : 'border-amber-500/25 bg-amber-500/5',
                )}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-white flex items-center gap-1.5 min-w-0">
                    {d.decision === 'APPROVED'
                      ? <Check size={14} className="text-emerald-400 shrink-0" />
                      : <MessageSquare size={14} className="text-amber-400 shrink-0" />}
                    <span className="truncate">{d.approverLabel}</span>
                    {d.byClient && (
                      <span className="text-2xs text-gray-400 border border-bg-border rounded px-1.5 py-px shrink-0">
                        Client
                      </span>
                    )}
                  </p>
                  <span className={cn('text-2xs font-semibold whitespace-nowrap',
                    d.decision === 'APPROVED' ? 'text-emerald-400' : 'text-amber-400')}>
                    {d.decision === 'APPROVED' ? 'Approved' : 'Changes requested'}
                  </span>
                </div>
                <p className="text-2xs text-gray-500 mt-1">
                  {new Date(d.createdAt).toLocaleString()}
                  {d.identityVerified && ' · identity verified'}
                </p>
                {d.comment && (
                  <p className="text-xs text-gray-300 mt-1.5 break-words whitespace-pre-wrap">{d.comment}</p>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {openRequests.length > 0 && (
        <SectionCard title={`Change requests · ${openRequests.length}`} icon={MessageSquare}>
          <ul className="space-y-2.5">
            {openRequests.map((r) => (
              <li key={r.id} className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
                <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span className="text-xs font-semibold text-white truncate">{r.authorLabel}</span>
                    {r.isClient && (
                      <span className="text-2xs text-gray-400 border border-bg-border rounded px-1.5 py-px">Client</span>
                    )}
                    <span className="text-2xs text-gray-500">{timeAgo(r.createdAt)}</span>
                  </div>
                  <CommentStatusBadge status={r.status} />
                </div>
                <p className="text-sm text-gray-300 break-words whitespace-pre-wrap">{r.body}</p>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <AnchorChip anchor={r.anchor} orphaned={r.anchorOrphaned} />
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void resolve(r.id)}
                    className="text-2xs font-semibold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : null}
                    Mark resolved
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

// ── shared ───────────────────────────────────────────────────────────────────

function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
      <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
      <p className="text-sm text-white font-semibold mb-1">Something went wrong</p>
      <p className="text-xs text-gray-400 mb-3 break-words">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className={cn('btn btn-secondary text-xs inline-flex items-center gap-1.5')}>
          <RefreshCw size={13} /> Try again
        </button>
      )}
    </div>
  );
}


// ── Messages tab ─────────────────────────────────────────────────────────────

/**
 * The team's side of the campaign conversation.
 *
 * Opening the tab marks the client's messages read, which is what a person
 * means by "I have seen it" — a separate button would just be a chore.
 */
export function MessagesPanel({
  campaignId, onChanged,
}: {
  campaignId: string;
  onChanged?: () => void;
}) {
  const [messages, setMessages] = useState<CampaignMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listCampaignMessages(campaignId);
      setMessages(res.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load messages');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const markRead = useCallback(() => {
    void markCampaignMessagesRead(campaignId).then(() => onChanged?.()).catch(() => {});
  }, [campaignId, onChanged]);

  return (
    <SectionCard title="Conversation" icon={MessageSquare}>
      <ConversationPanel
        audience="team"
        messages={messages.map((m) => ({
          id: m.id, body: m.body, authorLabel: m.authorLabel,
          isSystem: m.isSystem, createdAt: m.createdAt,
          readByOther: m.readByOther,
          // The team's own messages are the non-client ones.
          mine: !m.isClient,
        }))}
        loading={loading}
        error={error}
        onRetry={load}
        onVisible={markRead}
        streamUrl={campaignMessageStreamUrl(campaignId)}
        live={() => { void load(); }}
        onSend={async (body) => {
          await sendCampaignMessage(campaignId, body);
          await load();
          onChanged?.();
        }}
      />
    </SectionCard>
  );
}
