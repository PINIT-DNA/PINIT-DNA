import { useState, useCallback, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  Plus, Archive, Users, Activity, Sparkles, CheckCircle2, GitBranch, ScrollText,
  Share2, Pencil, RefreshCw, Trash2, UserPlus, ExternalLink, Shield,
  MessageSquare, ChevronRight, PackageCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useApi, invalidateApiCache } from '../../hooks/useApi';
import {
  getCampaign, listCampaignMembers, listCampaignAssets, listCampaignActivity,
  removeCampaignMember,
  type Campaign, type CampaignMember, type CampaignAsset, type CampaignActivityItem,
} from '../../services/business.api';
import { formatBytes } from '../../lib/file-type-utils';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import {
  BusinessPage, Breadcrumbs, SectionCard, StatTile, SkeletonRows, SkeletonTiles,
  TabBar, ComingSoonPanel, PageError, EmptyHint,
} from '../../components/business/clients/BusinessKit';
import { VersionsPanel, ApprovalsPanel, MessagesPanel } from '../../components/business/review/CampaignReviewPanels';
import { PeoplePanel } from '../../components/business/review/PeoplePanel';
import { RightsPanel } from '../../components/business/review/RightsPanel';
import { HandoverPanel } from '../../components/business/review/HandoverPanel';
import { listCampaignChangeRequests, listCampaignMessages } from '../../services/business.api';
import { CampaignFormModal } from '../../components/business/clients/CampaignFormModal';
import { AddCampaignPersonModal } from '../../components/business/clients/AddCampaignPersonModal';

type Tab = 'overview' | 'assets' | 'people' | 'approvals' | 'versions' | 'messages' | 'rights' | 'handover' | 'sharing' | 'activity' | 'intelligence';

export function CampaignWorkspacePage() {
  const { campaignId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (id: Tab) => setParams({ tab: id }, { replace: true });

  // Live count of open change requests — drives the Approvals tab badge and the
  // Needs attention row on Overview. Refetched whenever review state changes.
  const [pendingCount, setPendingCount] = useState<number | undefined>(undefined);
  const [unreadMessages, setUnreadMessages] = useState<number | undefined>(undefined);
  const [reviewNonce, setReviewNonce] = useState(0);
  const refreshReview = useCallback(() => setReviewNonce((n) => n + 1), []);

  const [editOpen, setEditOpen] = useState(false);
  const [personOpen, setPersonOpen] = useState(false);

  const fetchCampaign = useCallback(() => getCampaign(campaignId), [campaignId]);
  const fetchMembers = useCallback(() => listCampaignMembers(campaignId), [campaignId]);
  const fetchAssets = useCallback(() => listCampaignAssets(campaignId), [campaignId]);
  const fetchActivity = useCallback(() => listCampaignActivity(campaignId), [campaignId]);

  const { data: campaign, loading, error, refetch: refetchCampaign } = useApi<Campaign>(
    fetchCampaign, [campaignId], { cacheKey: `business-campaign-${campaignId}` },
  );
  const { data: members, loading: membersLoading, refetch: refetchMembers } = useApi<CampaignMember[]>(
    fetchMembers, [campaignId], { cacheKey: `business-campaign-members-${campaignId}` },
  );
  const { data: assets, loading: assetsLoading, refetch: refetchAssets } = useApi<CampaignAsset[]>(
    fetchAssets, [campaignId], { cacheKey: `business-campaign-assets-${campaignId}` },
  );
  const { data: activity, loading: activityLoading } = useApi<CampaignActivityItem[]>(
    fetchActivity, [campaignId], { cacheKey: `business-campaign-activity-${campaignId}` },
  );

  // Open change requests across the campaign. Kept out of useApi's cache on
  // purpose: it must reflect an action taken seconds ago, not a cached page.
  useEffect(() => {
    let cancelled = false;
    if (!campaignId) return;
    listCampaignChangeRequests(campaignId)
      .then((rows) => { if (!cancelled) setPendingCount(rows.length); })
      // A failed count must not surface an error over the whole page — the tab
      // simply shows no badge.
      .catch(() => { if (!cancelled) setPendingCount(undefined); });
    listCampaignMessages(campaignId)
      .then((res) => { if (!cancelled) setUnreadMessages(res.unread); })
      .catch(() => { if (!cancelled) setUnreadMessages(undefined); });
    return () => { cancelled = true; };
  }, [campaignId, reviewNonce]);

  const handleSaved = useCallback((updated: Campaign) => {
    invalidateApiCache('business-');
    setEditOpen(false);
    toast.success(`${updated.name} updated`);
    refetchCampaign();
  }, [refetchCampaign]);

  const handlePersonAdded = useCallback(() => {
    invalidateApiCache('business-');
    setPersonOpen(false);
    refetchMembers();
    refetchCampaign();
  }, [refetchMembers, refetchCampaign]);

  const handleRemovePerson = useCallback(async (member: CampaignMember) => {
    if (!window.confirm(`Remove ${member.name ?? 'this person'} from the campaign?`)) return;
    try {
      await removeCampaignMember(campaignId, member.id);
      invalidateApiCache('business-');
      toast.success('Removed from campaign');
      refetchMembers();
      refetchCampaign();
    } catch {
      toast.error('Could not remove — try again');
    }
  }, [campaignId, refetchMembers, refetchCampaign]);

  if (error) {
    return <PageError message={error} backTo="/business/clients" backLabel="Back to clients" />;
  }

  const protectHref = `/generate?campaignId=${encodeURIComponent(campaignId)}`;
  const externalCount = members?.filter((m) => m.isExternal).length ?? 0;

  const TABS = [
    { id: 'overview' as const, label: 'Overview', icon: Activity },
    { id: 'assets' as const, label: 'Assets', icon: Archive, count: assets?.length },
    { id: 'people' as const, label: 'People', icon: Users, count: members?.length },
    { id: 'approvals' as const, label: 'Approvals', icon: CheckCircle2, count: pendingCount },
    { id: 'versions' as const, label: 'Versions', icon: GitBranch },
    { id: 'rights' as const, label: 'Rights', icon: ScrollText },
    { id: 'handover' as const, label: 'Handover', icon: PackageCheck },
    { id: 'messages' as const, label: 'Messages', icon: MessageSquare, count: unreadMessages },
    { id: 'sharing' as const, label: 'Sharing', icon: Share2 },
    { id: 'activity' as const, label: 'Activity', icon: Activity },
    { id: 'intelligence' as const, label: 'Intelligence', icon: Sparkles, soon: true },
  ];

  return (
    <BusinessPage>
      <Breadcrumbs
        items={[
          { label: 'Business', to: '/business' },
          { label: 'Clients', to: '/business/clients' },
          ...(campaign?.client ? [{ label: campaign.client.name, to: `/business/clients/${campaign.client.id}` }] : []),
          { label: campaign?.name ?? 'Loading…' },
        ]}
      />

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          {loading && !campaign ? (
            <>
              <div className="h-7 w-64 rounded-lg bg-bg-elevated animate-pulse" />
              <div className="h-4 w-48 rounded bg-bg-elevated animate-pulse mt-2" />
            </>
          ) : (
            <>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">{campaign?.name}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {formatRange(campaign?.startDate ?? null, campaign?.endDate ?? null)}
                {campaign?.client && <> · {campaign.client.name}</>}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setEditOpen(true)} disabled={!campaign} className="btn btn-secondary btn-sm">
            <Pencil size={13} /> Edit
          </button>
          <Link to={protectHref} className="btn btn-primary btn-sm">
            <Plus size={14} /> Protect asset
          </Link>
        </div>
      </div>

      {loading && !campaign ? (
        <SkeletonTiles count={4} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Assets" value={campaign?.assetCount ?? 0} icon={Archive} accent="dna" />
          <StatTile label="People" value={campaign?.memberCount ?? 0} icon={Users} accent="cyan" />
          <StatTile label="External creators" value={externalCount} icon={ExternalLink} accent="purple" />
          <StatTile label="Status" value={statusLabel(campaign?.status ?? 'ACTIVE')} icon={Shield} accent="emerald" />
        </div>
      )}

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {/* Needs attention — shown only when something actually needs it,
                so an all-clear campaign is not padded with an empty panel. */}
            {typeof pendingCount === 'number' && pendingCount > 0 && (
              <button
                type="button"
                onClick={() => setTab('approvals')}
                className="w-full text-left rounded-xl border border-amber-500/30 bg-amber-500/5
                           px-4 py-3 flex items-center gap-3 hover:bg-amber-500/10 transition-colors"
              >
                <span className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/25
                                 flex items-center justify-center shrink-0">
                  <MessageSquare size={16} className="text-amber-400" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">
                    {pendingCount === 1
                      ? '1 change request needs a response'
                      : `${pendingCount} change requests need a response`}
                  </span>
                  <span className="block text-2xs text-gray-400 mt-0.5">Open Approvals to review them</span>
                </span>
                <ChevronRight size={16} className="text-amber-400 shrink-0" />
              </button>
            )}

            <SectionCard title="Recent assets" icon={Archive}>
              {assetsLoading && !assets ? (
                <SkeletonRows rows={3} />
              ) : !assets || assets.length === 0 ? (
                <EmptyHint
                  text="No assets in this campaign yet."
                  action={<Link to={protectHref} className="btn btn-primary btn-sm"><Plus size={14} /> Protect asset</Link>}
                />
              ) : (
                <AssetList assets={assets.slice(0, 5)} />
              )}
            </SectionCard>
            <SectionCard title="Activity" icon={Activity}>
              {activityLoading && !activity ? (
                <SkeletonRows rows={3} />
              ) : !activity || activity.length === 0 ? (
                <EmptyHint text="Nothing has happened on this campaign yet." />
              ) : (
                <ActivityList items={activity.slice(0, 6)} />
              )}
            </SectionCard>
          </div>
          <div className="space-y-4">
            <SectionCard title="People" icon={Users} action={
              <button onClick={() => setPersonOpen(true)} className="btn-ghost btn-sm text-xs text-dna-400">
                <UserPlus size={12} /> Add
              </button>
            }>
              {membersLoading && !members ? (
                <SkeletonRows rows={3} />
              ) : !members || members.length === 0 ? (
                <EmptyHint text="No one connected yet." />
              ) : (
                <PeopleList members={members.slice(0, 6)} />
              )}
            </SectionCard>
            {campaign?.description && (
              <SectionCard title="About" icon={ScrollText}>
                <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{campaign.description}</p>
              </SectionCard>
            )}
          </div>
        </div>
      )}

      {tab === 'assets' && (
        <SectionCard
          title={assets ? `${assets.length} asset${assets.length === 1 ? '' : 's'}` : 'Assets'}
          icon={Archive}
          action={
            <div className="flex items-center gap-2">
              <button onClick={refetchAssets} disabled={assetsLoading} className="btn-ghost btn-sm text-xs text-gray-500">
                <RefreshCw size={12} className={assetsLoading ? 'animate-spin' : ''} />
              </button>
              <Link to={protectHref} className="btn btn-primary btn-sm"><Plus size={13} /> Protect asset</Link>
            </div>
          }
        >
          {assetsLoading && !assets ? (
            <SkeletonRows rows={4} />
          ) : !assets || assets.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="No assets yet"
              description={`Protect an asset to add it to ${campaign?.name ?? 'this campaign'}. It keeps its Pinit identity and protection.`}
              action={<Link to={protectHref} className="btn btn-primary btn-sm"><Plus size={14} /> Protect asset</Link>}
            />
          ) : (
            <AssetList assets={assets} />
          )}
        </SectionCard>
      )}

      {tab === 'people' && (
        <PeoplePanel
          campaignId={campaignId}
          assets={assets}
          onAddPerson={() => setPersonOpen(true)}
          onRemovePerson={(memberId, name) =>
            handleRemovePerson({ id: memberId, name } as CampaignMember)}
          onChanged={() => { refetchMembers(); refetchCampaign(); refreshReview(); }}
        />
      )}

      {tab === 'sharing' && (
        <SectionCard title="Sharing" icon={Share2}>
          {!assets || assets.length === 0 ? (
            <EmptyHint text="Protect an asset into this campaign first — then share it from Digital Assets with full tracking." />
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">
                Campaign assets are shared through Pinit&apos;s existing tracked share links — every view and download is logged.
              </p>
              <ul className="divide-y divide-bg-border -mx-1">
                {assets.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-1 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{a.originalFilename}</p>
                    </div>
                    {a.vaultId ? (
                      <Link to={`/vault/assets/${a.vaultId}/share`} className="btn btn-secondary btn-sm shrink-0">
                        <Share2 size={12} /> Share
                      </Link>
                    ) : (
                      <Badge variant="muted">Not in vault</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'activity' && (
        <SectionCard title="Activity" icon={Activity}>
          {activityLoading && !activity ? (
            <SkeletonRows rows={5} />
          ) : !activity || activity.length === 0 ? (
            <EmptyHint text="Nothing has happened on this campaign yet." />
          ) : (
            <ActivityList items={activity} />
          )}
        </SectionCard>
      )}

      {tab === 'approvals' && (
        <ApprovalsPanel campaignId={campaignId} assets={assets} onChanged={refreshReview} />
      )}

      {tab === 'messages' && (
        <MessagesPanel campaignId={campaignId} onChanged={refreshReview} />
      )}

      {tab === 'versions' && (
        <VersionsPanel assets={assets} assetsLoading={assetsLoading} onChanged={refreshReview} />
      )}

      {tab === 'rights' && (
        <RightsPanel campaignId={campaignId} />
      )}

      {tab === 'handover' && (
        <HandoverPanel campaignId={campaignId} onChanged={refreshReview} />
      )}

      {tab === 'intelligence' && (
        <SectionCard title="Intelligence" icon={Sparkles}>
          <ComingSoonPanel
            title="Campaign intelligence"
            detail="Where this campaign's work appears, which creators contributed, and what needs verification. Arrives once monitoring is campaign-aware."
          />
        </SectionCard>
      )}

      {campaign && (
        <>
          <CampaignFormModal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            clientId={campaign.clientId}
            clientName={campaign.client?.name ?? ''}
            onSaved={handleSaved}
            existing={campaign}
          />
          <AddCampaignPersonModal
            open={personOpen}
            onClose={() => setPersonOpen(false)}
            campaignId={campaign.id}
            onAdded={handlePersonAdded}
          />
        </>
      )}
    </BusinessPage>
  );
}

function AssetList({ assets }: { assets: CampaignAsset[] }) {
  return (
    <ul className="divide-y divide-bg-border -mx-1">
      {assets.map((a) => (
        <li key={a.id} className="flex items-center gap-3 px-1 py-2.5">
          <span className="w-8 h-8 rounded-lg bg-bg-elevated border border-bg-border flex items-center justify-center text-sm shrink-0">
            {assetIcon(a.assetType)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white truncate">{a.originalFilename}</p>
            <p className="text-2xs text-gray-500">
              {formatBytes(a.sizeBytes)} · {format(new Date(a.createdAt), 'MMM d, yyyy')}
            </p>
          </div>
          <Badge variant="success" className="shrink-0 hidden sm:inline-flex">Protected</Badge>
        </li>
      ))}
    </ul>
  );
}

function PeopleList({ members, onRemove }: { members: CampaignMember[]; onRemove?: (m: CampaignMember) => void }) {
  return (
    <ul className="divide-y divide-bg-border -mx-1">
      {members.map((m) => (
        <li key={m.id} className="flex items-center gap-3 px-1 py-2.5">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-2xs font-bold shrink-0 ${
            m.isExternal
              ? 'bg-purple/10 text-purple border border-purple/20'
              : 'bg-dna-500/10 text-dna-400 border border-dna-500/20'
          }`}>
            {initials(m.name ?? '?')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white truncate">{m.name ?? 'Unnamed'}</p>
            <p className="text-2xs text-gray-500 truncate">
              {[m.roleLabel, m.shortId, m.platform].filter(Boolean).join(' · ') || (m.isExternal ? 'External creator' : 'Team member')}
            </p>
          </div>
          {m.isExternal && <Badge variant="purple" className="shrink-0 hidden sm:inline-flex">External</Badge>}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(m)}
              className="btn-ghost btn-sm text-danger shrink-0"
              title="Remove from campaign"
              aria-label={`Remove ${m.name ?? 'person'} from campaign`}
            >
              <Trash2 size={13} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ActivityList({ items }: { items: CampaignActivityItem[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.id} className="flex items-start gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-dna-500 mt-1.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-300 leading-snug">{i.title}</p>
            <p className="text-2xs text-gray-600 mt-0.5">{format(new Date(i.createdAt), 'MMM d, yyyy · HH:mm')}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function assetIcon(type: string): string {
  return ({ IMAGE: '🖼️', VIDEO: '🎬', DOCUMENT: '📄', AUDIO: '🎵' } as Record<string, string>)[type] ?? '📦';
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'No dates set';
  const f = (d: string) => format(new Date(d), 'MMM d, yyyy');
  if (start && end) return `${f(start)} – ${f(end)}`;
  return start ? `From ${f(start)}` : `Until ${f(end as string)}`;
}

function statusLabel(s: Campaign['status']): string {
  return { ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' }[s] ?? s;
}
