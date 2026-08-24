/**
 * Business Overview — the client/campaign lead section.
 *
 * Sits above the existing asset/investigation/team snapshots and answers
 * "what's happening across my client work right now" before the detail below.
 */
import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users, Megaphone, Archive, ExternalLink, Plus, ChevronRight, Briefcase } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApi, invalidateApiCache } from '../../../hooks/useApi';
import { getBusinessOverview, type BusinessOverview, type BusinessClient } from '../../../services/business.api';
import { Badge } from '../../ui/Badge';
import { StatTile, SectionCard, EmptyHint, SkeletonRows, SkeletonTiles } from '../clients/BusinessKit';
import { ClientFormModal } from '../clients/ClientFormModal';

export function ClientsOverviewSection() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApi<BusinessOverview>(
    getBusinessOverview, [], { cacheKey: 'business-overview' },
  );
  const [addOpen, setAddOpen] = useState(false);

  const handleSaved = useCallback((client: BusinessClient) => {
    invalidateApiCache('business-');
    setAddOpen(false);
    toast.success(`${client.name} added`);
    refetch();
    navigate(`/business/clients/${client.id}`);
  }, [refetch, navigate]);

  // A failed overview fetch must never blank the rest of the dashboard.
  if (error) {
    return (
      <SectionCard title="Client work" icon={Briefcase}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500">Could not load client data.</p>
          <button onClick={refetch} className="btn btn-secondary btn-sm">Retry</button>
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      {loading && !data ? (
        <SkeletonTiles count={4} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Clients" value={data?.clientCount ?? 0} icon={Users} accent="dna" to="/business/clients" />
          <StatTile label="Campaigns" value={data?.campaignCount ?? 0} icon={Megaphone} accent="cyan" to="/business/clients" />
          <StatTile label="Campaign assets" value={data?.assetCount ?? 0} icon={Archive} accent="emerald" />
          <StatTile label="External creators" value={data?.creatorCount ?? 0} icon={ExternalLink} accent="purple" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard
          title="Your clients"
          icon={Users}
          action={
            <button onClick={() => setAddOpen(true)} className="btn-ghost btn-sm text-xs text-dna-400">
              <Plus size={12} /> New client
            </button>
          }
        >
          {loading && !data ? (
            <SkeletonRows rows={3} />
          ) : !data || data.recentClients.length === 0 ? (
            <EmptyHint
              text="No clients yet — add your first to start organizing campaigns and assets."
              action={
                <button onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm">
                  <Plus size={14} /> Add client
                </button>
              }
            />
          ) : (
            <>
              <ul className="divide-y divide-bg-border -mx-1">
                {data.recentClients.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/business/clients/${c.id}`}
                      className="flex items-center gap-3 px-1 py-2.5 hover:bg-bg-elevated/50 rounded-lg transition-colors group"
                    >
                      <span className="w-8 h-8 rounded-lg bg-dna-500/10 text-dna-400 border border-dna-500/20 flex items-center justify-center text-2xs font-bold shrink-0">
                        {initials(c.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{c.name}</p>
                        <p className="text-2xs text-gray-500">
                          {c.campaignCount} campaign{c.campaignCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <ChevronRight size={15} className="text-gray-600 group-hover:text-dna-400 transition-colors shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
              {data.clientCount > data.recentClients.length && (
                <Link to="/business/clients" className="text-xs text-dna-400 hover:text-dna-300 mt-3 inline-flex items-center gap-1">
                  View all {data.clientCount} clients <ChevronRight size={12} />
                </Link>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard title="Active campaigns" icon={Megaphone}>
          {loading && !data ? (
            <SkeletonRows rows={3} />
          ) : !data || data.recentCampaigns.length === 0 ? (
            <EmptyHint text="No campaigns yet. Open a client to create their first campaign." />
          ) : (
            <ul className="divide-y divide-bg-border -mx-1">
              {data.recentCampaigns.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/business/campaigns/${c.id}`}
                    className="flex items-center gap-3 px-1 py-2.5 hover:bg-bg-elevated/50 rounded-lg transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{c.name}</p>
                      <p className="text-2xs text-gray-500 truncate">{c.clientName}</p>
                    </div>
                    <Badge variant={c.assetCount > 0 ? 'dna' : 'muted'} className="shrink-0 hidden sm:inline-flex">
                      {c.assetCount} assets
                    </Badge>
                    <ChevronRight size={15} className="text-gray-600 group-hover:text-dna-400 transition-colors shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <ClientFormModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={handleSaved} />
    </div>
  );
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}
