import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Globe, Users as UsersIcon } from 'lucide-react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { fetchOrganizationProfile } from '../api/super-admin.api';

type Tab = 'overview' | 'members' | 'campaigns' | 'clients';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'clients', label: 'Clients' },
];

export function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [org, setOrg] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchOrganizationProfile(id).then(setOrg).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!org) {
    return <p className="text-gray-500">Organization not found</p>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/admin/organizations')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={16} /> Back to organizations
      </button>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
            <Building2 size={22} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{org.name ?? org.shortId}</h1>
            <p className="text-sm text-gray-500">{org.shortId} · {org.industry ?? 'No industry set'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase text-gray-400">Owner</p>
          <p className="text-sm text-gray-900 mt-1 font-medium">{org.ownerUser?.fullName ?? org.ownerUser?.shortId ?? '—'}</p>
          <p className="text-xs text-gray-500">{org.ownerUser?.email ?? org.ownerUser?.shortId}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase text-gray-400">Size</p>
          <p className="text-sm text-gray-900 mt-1 font-medium">{org.organizationSize ?? '—'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase text-gray-400">Country</p>
          <p className="text-sm text-gray-900 mt-1 font-medium flex items-center gap-1"><Globe size={13} className="text-gray-400" /> {org.country ?? '—'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase text-gray-400">Members</p>
          <p className="text-sm text-gray-900 mt-1 font-medium flex items-center gap-1"><UsersIcon size={13} className="text-gray-400" /> {org._count?.members ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          ['Campaigns', org._count?.campaigns ?? 0],
          ['Clients', org._count?.clients ?? 0],
          ['DNA Records', org._count?.dnaRecords ?? 0],
          ['API Keys', org._count?.apiKeys ?? 0],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-[11px] uppercase text-gray-400">{label}</p>
            <p className="text-lg font-semibold text-gray-900 tabular-nums mt-1">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid md:grid-cols-2 gap-6">
          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-medium text-gray-900">Profile</h3>
            {[
              ['Business Type', org.businessType],
              ['Website', org.website],
              ['GST', org.gst],
              ['Support Email', org.supportEmail],
              ['Founded', org.foundedYear],
              ['Created', format(new Date(org.createdAt), 'PPpp')],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-gray-500">{k}</span>
                <span className="text-gray-800">{v ?? '—'}</span>
              </div>
            ))}
          </section>
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Governance</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Departments</span><p className="text-gray-900 font-medium">{org.departments?.length ?? 0}</p></div>
              <div><span className="text-gray-500">Workspaces</span><p className="text-gray-900 font-medium">{org.workspaces?.length ?? 0}</p></div>
              <div><span className="text-gray-500">Webhooks</span><p className="text-gray-900 font-medium">{org._count?.webhooks ?? 0}</p></div>
              <div><span className="text-gray-500">Audit Log Entries</span><p className="text-gray-900 font-medium">{org._count?.auditLogs ?? 0}</p></div>
            </div>
            {org.aboutDescription && <p className="text-sm text-gray-500 mt-4 border-t border-gray-100 pt-3">{org.aboutDescription}</p>}
          </section>
        </div>
      )}

      {tab === 'members' && (
        <LightDataTable
          rows={org.members ?? []}
          keyField="id"
          emptyMessage="No members yet"
          columns={[
            { key: 'user', header: 'User', render: (r: any) => r.user?.fullName ?? r.user?.shortId },
            { key: 'email', header: 'Email', render: (r: any) => r.user?.email ?? '—' },
            { key: 'role', header: 'Role', render: (r: any) => <LightStatusBadge value={r.role} /> },
            { key: 'department', header: 'Department', render: (r: any) => r.department?.name ?? '—' },
            { key: 'joined', header: 'Joined', render: (r: any) => format(new Date(r.joinedAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {tab === 'campaigns' && (
        <LightDataTable
          rows={org.campaigns ?? []}
          keyField="id"
          emptyMessage="No campaigns yet"
          columns={[
            { key: 'name', header: 'Name', render: (r: any) => r.name },
            { key: 'status', header: 'Status', render: (r: any) => <LightStatusBadge value={r.status} /> },
            { key: 'start', header: 'Start', render: (r: any) => r.startDate ? format(new Date(r.startDate), 'MMM d, yyyy') : '—' },
            { key: 'end', header: 'End', render: (r: any) => r.endDate ? format(new Date(r.endDate), 'MMM d, yyyy') : '—' },
            { key: 'created', header: 'Created', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {tab === 'clients' && (
        <LightDataTable
          rows={org.clients ?? []}
          keyField="id"
          emptyMessage="No clients yet"
          columns={[
            { key: 'name', header: 'Name', render: (r: any) => r.name },
            { key: 'company', header: 'Company', render: (r: any) => r.companyName ?? '—' },
            { key: 'created', header: 'Added', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}
    </div>
  );
}
