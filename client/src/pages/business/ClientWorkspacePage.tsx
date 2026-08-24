import { useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  Plus, Megaphone, Archive, Users, Truck, ScrollText, Activity, Sparkles,
  Mail, Pencil, ChevronRight, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useApi, invalidateApiCache } from '../../hooks/useApi';
import { getClient, listCampaigns, type BusinessClient, type Campaign } from '../../services/business.api';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import {
  BusinessPage, Breadcrumbs, SectionCard, SkeletonRows, TabBar, ComingSoonPanel, PageError,
} from '../../components/business/clients/BusinessKit';
import { ClientFormModal } from '../../components/business/clients/ClientFormModal';
import { CampaignFormModal } from '../../components/business/clients/CampaignFormModal';

type Tab = 'campaigns' | 'assets' | 'people' | 'deliveries' | 'rights' | 'activity' | 'intelligence';

const TABS = [
  { id: 'campaigns' as const, label: 'Campaigns', icon: Megaphone },
  { id: 'assets' as const, label: 'Assets', icon: Archive },
  { id: 'people' as const, label: 'People', icon: Users },
  { id: 'deliveries' as const, label: 'Deliveries', icon: Truck, soon: true },
  { id: 'rights' as const, label: 'Rights', icon: ScrollText, soon: true },
  { id: 'activity' as const, label: 'Activity', icon: Activity, soon: true },
  { id: 'intelligence' as const, label: 'Intelligence', icon: Sparkles, soon: true },
];

export function ClientWorkspacePage() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'campaigns';
  const setTab = (id: Tab) => setParams({ tab: id }, { replace: true });

  const [editOpen, setEditOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const fetchClient = useCallback(() => getClient(clientId), [clientId]);
  const fetchCampaigns = useCallback(() => listCampaigns(clientId), [clientId]);

  const { data: client, loading, error, refetch: refetchClient } = useApi<BusinessClient>(
    fetchClient, [clientId], { cacheKey: `business-client-${clientId}` },
  );
  const { data: campaigns, loading: campaignsLoading, refetch: refetchCampaigns } = useApi<Campaign[]>(
    fetchCampaigns, [clientId], { cacheKey: `business-campaigns-${clientId}` },
  );

  const handleClientSaved = useCallback(() => {
    invalidateApiCache('business-');
    setEditOpen(false);
    toast.success('Client updated');
    refetchClient();
  }, [refetchClient]);

  const handleCampaignSaved = useCallback((campaign: Campaign) => {
    invalidateApiCache('business-');
    setCampaignOpen(false);
    toast.success(`${campaign.name} created`);
    navigate(`/business/campaigns/${campaign.id}`);
  }, [navigate]);

  const subtitle = useMemo(() => {
    if (!client) return '';
    return [client.companyName, client.website].filter(Boolean).join(' · ');
  }, [client]);

  if (error) {
    return <PageError message={error} backTo="/business/clients" backLabel="Back to clients" />;
  }

  return (
    <BusinessPage>
      <Breadcrumbs
        items={[
          { label: 'Business', to: '/business' },
          { label: 'Clients', to: '/business/clients' },
          { label: client?.name ?? 'Loading…' },
        ]}
      />

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          {loading && !client ? (
            <>
              <div className="h-7 w-56 rounded-lg bg-bg-elevated animate-pulse" />
              <div className="h-4 w-40 rounded bg-bg-elevated animate-pulse mt-2" />
            </>
          ) : (
            <>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">{client?.name}</h1>
              <p className="text-sm text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                {subtitle || 'No company details yet'}
                {client?.contactEmail && (
                  <span className="flex items-center gap-1 text-gray-500">
                    <Mail size={11} />{client.contactEmail}
                  </span>
                )}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setEditOpen(true)} disabled={!client} className="btn btn-secondary btn-sm">
            <Pencil size={13} /> Edit
          </button>
          <button onClick={() => setCampaignOpen(true)} disabled={!client} className="btn btn-primary btn-sm">
            <Plus size={14} /> New campaign
          </button>
        </div>
      </div>

      <TabBar
        tabs={TABS.map((t) => (t.id === 'campaigns' ? { ...t, count: campaigns?.length } : t))}
        active={tab}
        onChange={setTab}
      />

      {tab === 'campaigns' && (
        <SectionCard
          title="Campaigns"
          icon={Megaphone}
          action={
            <button onClick={refetchCampaigns} disabled={campaignsLoading} className="btn-ghost btn-sm text-xs text-gray-500">
              <RefreshCw size={12} className={campaignsLoading ? 'animate-spin' : ''} />
            </button>
          }
        >
          {campaignsLoading && !campaigns ? (
            <SkeletonRows rows={3} />
          ) : !campaigns || campaigns.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet"
              description={`Create the first campaign for ${client?.name ?? 'this client'} to start grouping work.`}
              action={
                <button onClick={() => setCampaignOpen(true)} className="btn btn-primary btn-sm">
                  <Plus size={14} /> New campaign
                </button>
              }
            />
          ) : (
            <ul className="divide-y divide-bg-border -mx-1">
              {campaigns.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/business/campaigns/${c.id}`}
                    className="flex items-center gap-3 px-1 py-3 hover:bg-bg-elevated/50 rounded-lg transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                      <p className="text-xs text-gray-500 truncate">{formatRange(c.startDate, c.endDate)}</p>
                    </div>
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                      <Badge variant={c.assetCount > 0 ? 'dna' : 'muted'}>{c.assetCount} assets</Badge>
                      <Badge variant={statusVariant(c.status)}>{statusLabel(c.status)}</Badge>
                    </div>
                    <ChevronRight size={16} className="text-gray-600 group-hover:text-dna-400 transition-colors shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {tab === 'assets' && (
        <SectionCard title="Assets" icon={Archive}>
          <ComingSoonPanel
            title="Assets roll up from campaigns"
            detail="Open a campaign to see and add its protected assets. A combined client-wide asset view arrives with the next phase."
          />
        </SectionCard>
      )}

      {tab === 'people' && (
        <SectionCard title="People" icon={Users}>
          <ComingSoonPanel
            title="People are assigned per campaign"
            detail="Team members and external creators are connected inside each campaign's People tab."
          />
        </SectionCard>
      )}

      {tab === 'deliveries' && (
        <SectionCard title="Deliveries" icon={Truck}>
          <ComingSoonPanel title="Deliveries & handover" detail="Recording what was delivered to this client, and when, arrives with the Rights & Handover phase." />
        </SectionCard>
      )}

      {tab === 'rights' && (
        <SectionCard title="Usage rights" icon={ScrollText}>
          <ComingSoonPanel title="Usage rights" detail="Permitted-use records (social, web, print) for this client's assets arrive with the Rights & Handover phase." />
        </SectionCard>
      )}

      {tab === 'activity' && (
        <SectionCard title="Activity" icon={Activity}>
          <ComingSoonPanel title="Client activity" detail="A combined feed across this client's campaigns. Per-campaign activity is available now inside each campaign." />
        </SectionCard>
      )}

      {tab === 'intelligence' && (
        <SectionCard title="Intelligence" icon={Sparkles}>
          <ComingSoonPanel title="Client intelligence" detail="Where this client's work appears, and which relationships were discovered, arrives once monitoring is campaign-aware." />
        </SectionCard>
      )}

      <ClientFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={handleClientSaved} existing={client} />
      {client && (
        <CampaignFormModal
          open={campaignOpen}
          onClose={() => setCampaignOpen(false)}
          clientId={client.id}
          clientName={client.name}
          onSaved={handleCampaignSaved}
        />
      )}
    </BusinessPage>
  );
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

function statusVariant(s: Campaign['status']): 'success' | 'warning' | 'muted' | 'info' {
  return ({ ACTIVE: 'success', ON_HOLD: 'warning', COMPLETED: 'info', ARCHIVED: 'muted' } as const)[s] ?? 'muted';
}
