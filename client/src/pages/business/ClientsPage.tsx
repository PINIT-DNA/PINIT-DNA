import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Building2, ChevronRight, RefreshCw, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApi, invalidateApiCache } from '../../hooks/useApi';
import { listClients, type BusinessClient } from '../../services/business.api';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import { BusinessPage, Breadcrumbs, SectionCard, SkeletonRows } from '../../components/business/clients/BusinessKit';
import { ClientFormModal } from '../../components/business/clients/ClientFormModal';

export function ClientsPage() {
  const { data: clients, loading, error, refetch } = useApi<BusinessClient[]>(
    listClients, [], { cacheKey: 'business-clients' },
  );
  const [addOpen, setAddOpen] = useState(false);

  const handleSaved = useCallback((client: BusinessClient) => {
    invalidateApiCache('business-');
    setAddOpen(false);
    toast.success(`${client.name} added`);
    refetch();
  }, [refetch]);

  return (
    <BusinessPage>
      <Breadcrumbs items={[{ label: 'Business', to: '/business' }, { label: 'Clients' }]} />

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Users size={20} className="text-dna-400" /> Clients
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            The businesses and brands you create work for. Campaigns and assets live inside each one.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm" title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm">
            <Plus size={14} /> New client
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-6 text-center">
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={refetch} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : (
        <SectionCard title={clients ? `${clients.length} client${clients.length === 1 ? '' : 's'}` : 'Clients'} icon={Building2}>
          {loading && !clients ? (
            <SkeletonRows rows={4} />
          ) : !clients || clients.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No clients yet"
              description="Add your first client to start organizing campaigns and protected assets."
              action={
                <button onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm">
                  <Plus size={14} /> Add client
                </button>
              }
            />
          ) : (
            <ul className="divide-y divide-bg-border -mx-1">
              {clients.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/business/clients/${c.id}`}
                    className="flex items-center gap-3 px-1 py-3 hover:bg-bg-elevated/50 rounded-lg transition-colors group"
                  >
                    <span className="w-9 h-9 rounded-lg bg-dna-500/10 text-dna-400 border border-dna-500/20 flex items-center justify-center text-xs font-bold shrink-0">
                      {initials(c.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                      <p className="text-xs text-gray-500 truncate flex items-center gap-1.5">
                        {c.companyName && <span className="truncate">{c.companyName}</span>}
                        {c.website && (
                          <span className="flex items-center gap-1 truncate">
                            <Globe size={10} className="shrink-0" />{c.website}
                          </span>
                        )}
                        {!c.companyName && !c.website && <span className="text-gray-600">No details yet</span>}
                      </p>
                    </div>
                    <Badge variant={c.campaignCount > 0 ? 'dna' : 'muted'} className="shrink-0 hidden sm:inline-flex">
                      {c.campaignCount} campaign{c.campaignCount === 1 ? '' : 's'}
                    </Badge>
                    <ChevronRight size={16} className="text-gray-600 group-hover:text-dna-400 transition-colors shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      <ClientFormModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={handleSaved} />
    </BusinessPage>
  );
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}
