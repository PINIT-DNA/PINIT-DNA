import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, User } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { fetchUserProfile, updateUserRole, toggleUserActive } from '../api/super-admin.api';
import { formatBytes } from '../../hooks/useApi';

type Tab = 'overview' | 'vault' | 'certificates' | 'shares' | 'logins' | 'monitoring' | 'tep';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'vault', label: 'Vault & DNA' },
  { id: 'certificates', label: 'Certificates' },
  { id: 'shares', label: 'Share Links' },
  { id: 'tep', label: 'Protected Downloads' },
  { id: 'logins', label: 'Sessions & Logins' },
  { id: 'monitoring', label: 'Monitoring' },
];

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!id) return;
    setLoading(true);
    fetchUserProfile(id)
      .then(setProfile)
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const handleRoleChange = async (role: string) => {
    if (!id) return;
    try {
      await updateUserRole(id, role);
      toast.success('Role updated');
      load();
    } catch {
      toast.error('Failed to update role');
    }
  };

  const handleToggle = async () => {
    if (!id) return;
    try {
      await toggleUserActive(id);
      toast.success('Account status updated');
      load();
    } catch {
      toast.error('Failed to update account');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return <p className="text-zinc-500">User not found</p>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/admin/users')}
        className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300 mb-4"
      >
        <ArrowLeft size={16} /> Back to users
      </button>

      <PageHeader
        title={profile.fullName ?? profile.shortId}
        description={`${profile.shortId} · ${profile.email ?? 'No email'}`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={profile.role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="px-3 py-1.5 bg-[#111113] border border-zinc-800 rounded text-sm text-zinc-300"
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
              <option value="ANALYST">ANALYST</option>
              <option value="AUDITOR">AUDITOR</option>
            </select>
            <button
              type="button"
              onClick={handleToggle}
              className="px-3 py-1.5 text-sm border border-zinc-700 rounded hover:bg-zinc-900 text-zinc-300"
            >
              {profile.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-[#111113] border border-zinc-800 rounded-lg p-4">
          <p className="text-[11px] uppercase text-zinc-500">Role</p>
          <div className="mt-1"><StatusBadge value={profile.role} /></div>
        </div>
        <div className="bg-[#111113] border border-zinc-800 rounded-lg p-4">
          <p className="text-[11px] uppercase text-zinc-500">Status</p>
          <div className="mt-1"><StatusBadge value={profile.isActive ? 'ACTIVE' : 'INACTIVE'} /></div>
        </div>
        <div className="bg-[#111113] border border-zinc-800 rounded-lg p-4">
          <p className="text-[11px] uppercase text-zinc-500">Biometric</p>
          <p className="text-sm text-zinc-200 mt-1 flex items-center gap-1">
            {profile.faceRegistered ? <Shield size={14} className="text-emerald-400" /> : <User size={14} />}
            {profile.faceRegistered ? 'Registered' : 'Not registered'}
          </p>
        </div>
        <div className="bg-[#111113] border border-zinc-800 rounded-lg p-4">
          <p className="text-[11px] uppercase text-zinc-500">Last Login</p>
          <p className="text-sm text-zinc-200 mt-1">
            {profile.lastLoginAt ? format(new Date(profile.lastLoginAt), 'MMM d, yyyy HH:mm') : 'Never'}
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-zinc-800 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-zinc-100 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid md:grid-cols-2 gap-6">
          <section className="bg-[#111113] border border-zinc-800 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium text-zinc-200">Profile</h3>
            {[
              ['Organization', profile.organization],
              ['Country', profile.country],
              ['Phone', profile.phone],
              ['Job Title', profile.jobTitle],
              ['Auth Method', profile.authMethod],
              ['Joined', format(new Date(profile.createdAt), 'PPpp')],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-zinc-500">{k}</span>
                <span className="text-zinc-300">{v ?? '—'}</span>
              </div>
            ))}
          </section>
          <section className="bg-[#111113] border border-zinc-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-zinc-200 mb-3">Summary</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-zinc-500">DNA Records</span><p className="text-zinc-200 font-medium">{profile.dnaRecords?.length ?? 0}</p></div>
              <div><span className="text-zinc-500">Certificates</span><p className="text-zinc-200 font-medium">{profile.certificates?.length ?? 0}</p></div>
              <div><span className="text-zinc-500">Share Links</span><p className="text-zinc-200 font-medium">{profile.shareLinks?.length ?? 0}</p></div>
              <div><span className="text-zinc-500">TEP Packages</span><p className="text-zinc-200 font-medium">{profile.tepPackages?.length ?? 0}</p></div>
            </div>
            {profile.bio && <p className="text-sm text-zinc-400 mt-4 border-t border-zinc-800 pt-3">{profile.bio}</p>}
          </section>
        </div>
      )}

      {tab === 'vault' && (
        <DataTable
          rows={profile.dnaRecords ?? []}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r: any) => r.imageFilename },
            { key: 'type', header: 'Type', render: (r: any) => r.fileType },
            { key: 'status', header: 'Status', render: (r: any) => <StatusBadge value={r.status} /> },
            { key: 'size', header: 'Size', render: (r: any) => formatBytes(r.imageSizeBytes) },
            { key: 'hash', header: 'SHA-256', className: 'font-mono text-xs max-w-[120px] truncate', render: (r: any) => r.sha256Hash?.slice(0, 16) + '…' },
            { key: 'vault', header: 'Encrypted', render: (r: any) => r.vaultRecord ? formatBytes(r.vaultRecord.encryptedSizeBytes) : '—' },
            { key: 'created', header: 'Created', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {tab === 'certificates' && (
        <DataTable
          rows={profile.certificates ?? []}
          keyField="id"
          columns={[
            { key: 'id', header: 'Certificate ID', render: (r: any) => <span className="font-mono text-xs">{r.certificateId}</span> },
            { key: 'status', header: 'Status', render: (r: any) => <StatusBadge value={r.status} /> },
            { key: 'created', header: 'Issued', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
            { key: 'revoked', header: 'Revoked', render: (r: any) => r.revokedAt ? format(new Date(r.revokedAt), 'MMM d, yyyy') : '—' },
          ]}
        />
      )}

      {tab === 'shares' && (
        <DataTable
          rows={profile.shareLinks ?? []}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r: any) => r.filename },
            { key: 'status', header: 'Status', render: (r: any) => <StatusBadge value={r.isActive ? 'ACTIVE' : 'REVOKED'} /> },
            { key: 'views', header: 'Views', render: (r: any) => r.viewCount },
            { key: 'downloads', header: 'Downloads', render: (r: any) => r.downloadCount },
            { key: 'access', header: 'Access Logs', render: (r: any) => r._count?.accessLogs ?? 0 },
            { key: 'created', header: 'Created', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {tab === 'tep' && (
        <DataTable
          rows={profile.tepPackages ?? []}
          keyField="id"
          columns={[
            { key: 'id', header: 'Package ID', render: (r: any) => <span className="font-mono text-xs">{r.id.slice(0, 12)}…</span> },
            { key: 'status', header: 'Status', render: (r: any) => <StatusBadge value={r.status} /> },
            { key: 'created', header: 'Created', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {tab === 'logins' && (
        <DataTable
          rows={profile.loginHistory ?? []}
          keyField="id"
          columns={[
            { key: 'method', header: 'Method', render: (r: any) => r.method },
            { key: 'ip', header: 'IP', render: (r: any) => <span className="font-mono text-xs">{r.ip ?? '—'}</span> },
            { key: 'location', header: 'Location', render: (r: any) => [r.city, r.country].filter(Boolean).join(', ') || '—' },
            { key: 'device', header: 'Device', render: (r: any) => [r.browser, r.os].filter(Boolean).join(' / ') || r.device || '—' },
            { key: 'success', header: 'Result', render: (r: any) => r.success ? 'Success' : r.failReason ?? 'Failed' },
            { key: 'time', header: 'Time', render: (r: any) => format(new Date(r.createdAt), 'MMM d HH:mm') },
          ]}
        />
      )}

      {tab === 'monitoring' && (
        <DataTable
          rows={profile.monitorRecords ?? []}
          keyField="id"
          columns={[
            { key: 'type', header: 'Scan Type', render: (r: any) => r.scanType },
            { key: 'status', header: 'Status', render: (r: any) => <StatusBadge value={r.status} /> },
            { key: 'last', header: 'Last Checked', render: (r: any) => r.lastCheckedAt ? format(new Date(r.lastCheckedAt), 'MMM d HH:mm') : '—' },
            { key: 'created', header: 'Created', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}
    </div>
  );
}
