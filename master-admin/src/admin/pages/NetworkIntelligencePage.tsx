import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, Share2 } from 'lucide-react';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatCard } from '../components/LightStatCard';
import { fetchNetworkOverview } from '../api/super-admin.api';
import type { NetworkOrgRow } from '../api/super-admin.api';

export function NetworkIntelligencePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ organizations: NetworkOrgRow[]; totals: { members: number; clients: number; campaigns: number }; totalOrganizations: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNetworkOverview()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }

  const maxNetwork = Math.max(...(data?.organizations.map((o) => o.networkSize) ?? [1]), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <LightStatCard label="Organizations" value={data?.totalOrganizations ?? 0} icon={Building2} />
        <LightStatCard label="Total Members" value={data?.totals.members ?? 0} icon={Users} />
        <LightStatCard label="Clients + Campaigns" value={(data?.totals.clients ?? 0) + (data?.totals.campaigns ?? 0)} icon={Share2} />
      </div>

      <p className="text-xs text-gray-500">
        Ranked by network reach — members, clients, and campaigns per organization. A full entity relationship graph is a larger, separate engineering effort; this is a structural view of the same real data.
      </p>

      <LightDataTable
        rows={data?.organizations ?? []}
        keyField="id"
        emptyMessage="No organizations yet"
        onRowClick={(r: NetworkOrgRow) => navigate(`/organizations/${r.id}`)}
        columns={[
          { key: 'name', header: 'Organization', render: (r: NetworkOrgRow) => (
            <div>
              <p className="text-gray-900">{r.name ?? r.shortId}</p>
              <p className="text-xs text-gray-400 font-mono">{r.shortId}</p>
            </div>
          )},
          { key: 'owner', header: 'Owner', render: (r: NetworkOrgRow) => <span className="font-mono text-xs">{r.owner?.shortId ?? '—'}</span> },
          { key: 'industry', header: 'Industry', render: (r: NetworkOrgRow) => r.industry ?? '—' },
          { key: 'members', header: 'Members', render: (r: NetworkOrgRow) => r.members },
          { key: 'clients', header: 'Clients', render: (r: NetworkOrgRow) => r.clients },
          { key: 'campaigns', header: 'Campaigns', render: (r: NetworkOrgRow) => r.campaigns },
          { key: 'assets', header: 'DNA Assets', render: (r: NetworkOrgRow) => r.assets },
          { key: 'reach', header: 'Network Reach', render: (r: NetworkOrgRow) => (
            <div className="flex items-center gap-2 min-w-[120px]">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(r.networkSize / maxNetwork) * 100}%` }} />
              </div>
              <span className="text-xs text-gray-500 tabular-nums w-6 text-right">{r.networkSize}</span>
            </div>
          )},
        ]}
      />
    </div>
  );
}
