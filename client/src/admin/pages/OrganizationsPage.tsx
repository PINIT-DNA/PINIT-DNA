import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { fetchAllOrganizations } from '../api/super-admin.api';

type OrgRow = {
  id: string;
  shortId: string;
  name: string | null;
  industry: string | null;
  organizationSize: string | null;
  country: string | null;
  createdAt: string;
  ownerUser: { shortId: string; fullName: string | null; email: string | null };
  _count: { members: number; campaigns: number; clients: number; dnaRecords: number };
};

export function OrganizationsPage() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchAllOrganizations({ q: q || undefined })
      .then((d) => setOrgs(d.organizations as OrgRow[]))
      .catch((e) => {
        setOrgs([]);
        setError(e instanceof Error ? e.message : 'Failed to load organizations');
      })
      .finally(() => setLoading(false));
  }, [q]);

  return (
    <div>
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by ID, name, country..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : (
        <LightDataTable
          rows={orgs}
          keyField="id"
          onRowClick={(row) => navigate(`/admin/organizations/${row.id}`)}
          emptyMessage="No organizations yet"
          columns={[
            { key: 'shortId', header: 'Org ID', render: (r) => <span className="font-mono text-gray-900">{r.shortId}</span> },
            { key: 'name', header: 'Name', render: (r) => r.name ?? '—' },
            { key: 'industry', header: 'Industry', render: (r) => r.industry ?? '—' },
            { key: 'size', header: 'Size', render: (r) => r.organizationSize ?? '—' },
            { key: 'owner', header: 'Owner', render: (r) => r.ownerUser?.fullName ?? r.ownerUser?.shortId ?? '—' },
            { key: 'members', header: 'Members', render: (r) => r._count.members },
            { key: 'campaigns', header: 'Campaigns', render: (r) => r._count.campaigns },
            { key: 'dna', header: 'DNA Records', render: (r) => r._count.dnaRecords },
            { key: 'country', header: 'Country', render: (r) => r.country ?? '—' },
            { key: 'created', header: 'Created', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}
    </div>
  );
}
