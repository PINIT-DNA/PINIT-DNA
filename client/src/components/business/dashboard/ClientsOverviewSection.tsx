/**
 * Business Overview — clients and campaigns on Home.
 */
import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users, Megaphone, Plus, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApi, invalidateApiCache } from '../../../hooks/useApi';
import { getBusinessOverview, type BusinessOverview, type BusinessClient } from '../../../services/business.api';
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

  if (error) {
    return (
      <section className="hub-home-block">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="hub-home-body">Could not load client data.</p>
          <button type="button" onClick={refetch} className="btn btn-secondary btn-sm">Retry</button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {loading && !data ? (
        <div className="skeleton h-4 w-64 rounded" />
      ) : (
        <p className="hub-home-meta">
          <Link to="/business/clients" className="hub-home-link">
            {data?.clientCount ?? 0} {(data?.clientCount ?? 0) === 1 ? 'client' : 'clients'}
          </Link>
          <span className="mx-2">·</span>
          <Link to="/business/clients" className="hub-home-link">
            {data?.campaignCount ?? 0} {(data?.campaignCount ?? 0) === 1 ? 'campaign' : 'campaigns'}
          </Link>
          <span className="mx-2">·</span>
          {(data?.assetCount ?? 0) === 1 ? '1 campaign asset' : `${data?.assetCount ?? 0} campaign assets`}
          <span className="mx-2">·</span>
          {(data?.creatorCount ?? 0) === 1 ? '1 external creator' : `${data?.creatorCount ?? 0} external creators`}
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="hub-home-block">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="hub-home-section flex items-center gap-2">
              <Users size={16} className="text-dna-500" /> Your clients
            </h2>
            <button type="button" onClick={() => setAddOpen(true)} className="hub-home-link inline-flex items-center gap-1">
              <Plus size={12} /> New client
            </button>
          </div>
          {loading && !data ? (
            <div className="skeleton h-20 rounded-xl" />
          ) : !data || data.recentClients.length === 0 ? (
            <div className="py-2">
              <p className="hub-home-body">No clients yet.</p>
              <button type="button" onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm mt-4 inline-flex gap-2">
                <Plus size={14} /> Add client
              </button>
            </div>
          ) : (
            <>
              <ul className="space-y-1">
                {data.recentClients.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/business/clients/${c.id}`}
                      className="hub-home-row flex items-center gap-3 px-3 py-2.5 group"
                    >
                      <span className="w-8 h-8 rounded-lg bg-dna-50 text-dna-600 dark:bg-dna-500/10 dark:text-dna-400 flex items-center justify-center text-[11px] font-bold shrink-0">
                        {initials(c.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="hub-home-card-title truncate">{c.name}</p>
                        <p className="hub-home-meta">
                          {c.campaignCount} campaign{c.campaignCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <ChevronRight size={15} className="text-slate-400 group-hover:text-dna-500 shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
              {data.clientCount > data.recentClients.length && (
                <Link to="/business/clients" className="hub-home-link mt-3 inline-flex items-center gap-1">
                  View all {data.clientCount} clients <ChevronRight size={12} />
                </Link>
              )}
            </>
          )}
        </section>

        <section className="hub-home-block">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="hub-home-section flex items-center gap-2">
              <Megaphone size={16} className="text-dna-500" /> Active campaigns
            </h2>
            <Link to="/business/clients" className="hub-home-link">View all</Link>
          </div>
          {loading && !data ? (
            <div className="skeleton h-20 rounded-xl" />
          ) : !data || data.recentCampaigns.length === 0 ? (
            <p className="hub-home-body">No campaigns yet. Open a client to create their first campaign.</p>
          ) : (
            <ul className="space-y-1">
              {data.recentCampaigns.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/business/campaigns/${c.id}`}
                    className="hub-home-row flex items-center gap-3 px-3 py-2.5 group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="hub-home-card-title truncate">{c.name}</p>
                      <p className="hub-home-meta truncate">{c.clientName}</p>
                    </div>
                    <span className="hub-home-meta shrink-0 hidden sm:inline">
                      {c.assetCount} {c.assetCount === 1 ? 'asset' : 'assets'}
                    </span>
                    <ChevronRight size={15} className="text-slate-400 group-hover:text-dna-500 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ClientFormModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={handleSaved} />
    </div>
  );
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}
