import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, User, LogOut } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import {
  fetchUserProfile, updateUserRole, toggleUserActive,
  signOutUserEverywhere, revokeSession, untrustDevice,
} from '../api/super-admin.api';
import { formatBytes } from '../../hooks/useApi';
import { useAdminCapabilities } from '../context/AdminCapabilitiesContext';

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
  const { isOwner } = useAdminCapabilities();
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

  const handleSignOutEverywhere = async () => {
    if (!id) return;
    if (!confirm("Sign this user out everywhere? Their current session stays valid until it naturally expires, but they won't be able to silently refresh it.")) return;
    try {
      const r = await signOutUserEverywhere(id);
      toast.success(`Revoked ${r.sessionsRevoked} session(s), removed ${r.refreshTokensDeleted} refresh token(s)`);
      load();
    } catch {
      toast.error('Failed to sign out user');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await revokeSession(sessionId);
      toast.success('Session revoked');
      load();
    } catch {
      toast.error('Failed to revoke session');
    }
  };

  const handleUntrustDevice = async (deviceId: string, currentlyTrusted: boolean) => {
    try {
      await untrustDevice(deviceId);
      toast.success(currentlyTrusted ? 'Device marked untrusted' : 'Device marked trusted');
      load();
    } catch {
      toast.error('Failed to update device');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return <p className="text-gray-500">User not found</p>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/users')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={16} /> Back to users
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{profile.fullName ?? profile.shortId}</h1>
          <p className="text-sm text-gray-500 mt-1">{profile.shortId} · {profile.email ?? 'No email'}</p>
        </div>
        {isOwner ? (
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={profile.role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-indigo-400"
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
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700"
            >
              {profile.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ) : (
          <span
            className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg bg-gray-50 shrink-0"
            title="Role changes and account activation are restricted to the platform owner"
          >
            Read-only — owner controls role &amp; status
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase text-gray-400">Role</p>
          <div className="mt-1"><LightStatusBadge value={profile.role} /></div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase text-gray-400">Status</p>
          <div className="mt-1"><LightStatusBadge value={profile.isActive ? 'ACTIVE' : 'INACTIVE'} /></div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase text-gray-400">Biometric</p>
          <p className="text-sm text-gray-800 mt-1 flex items-center gap-1">
            {profile.faceRegistered ? <Shield size={14} className="text-emerald-500" /> : <User size={14} />}
            {profile.faceRegistered ? 'Registered' : 'Not registered'}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase text-gray-400">Last Login</p>
          <p className="text-sm text-gray-800 mt-1">
            {profile.lastLoginAt ? format(new Date(profile.lastLoginAt), 'MMM d, yyyy HH:mm') : 'Never'}
          </p>
        </div>
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
              ['Organization', profile.organization],
              ['Country', profile.country],
              ['Phone', profile.phone],
              ['Job Title', profile.jobTitle],
              ['Auth Method', profile.authMethod],
              ['Joined', format(new Date(profile.createdAt), 'PPpp')],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-gray-500">{k}</span>
                <span className="text-gray-800">{v ?? '—'}</span>
              </div>
            ))}
          </section>
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Summary</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">DNA Records</span><p className="text-gray-900 font-medium">{profile.dnaRecords?.length ?? 0}</p></div>
              <div><span className="text-gray-500">Certificates</span><p className="text-gray-900 font-medium">{profile.certificates?.length ?? 0}</p></div>
              <div><span className="text-gray-500">Share Links</span><p className="text-gray-900 font-medium">{profile.shareLinks?.length ?? 0}</p></div>
              <div><span className="text-gray-500">TEP Packages</span><p className="text-gray-900 font-medium">{profile.tepPackages?.length ?? 0}</p></div>
            </div>
            {profile.bio && <p className="text-sm text-gray-500 mt-4 border-t border-gray-100 pt-3">{profile.bio}</p>}
          </section>

          {profile.identity && (
            <section className="bg-white border border-gray-200 rounded-xl p-4 md:col-span-2">
              <h3 className="text-sm font-medium text-gray-900 mb-1">Portfolio Identity</h3>
              <p className="text-xs text-gray-500 mb-3">
                One face, one code — every label this person can appear under across the platform.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  ['Root (biometric)', profile.identity.root],
                  ['Individual', profile.identity.individual],
                  ['Business', profile.identity.business],
                  ['Exchange', profile.identity.exchange],
                ].map(([label, id]) => (
                  <div key={label} className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-[10px] uppercase text-gray-400 mb-1">{label}</p>
                    <p className="text-xs font-mono text-gray-800 break-all">{id}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-3">
                Exchange runs its own database with no query bridge yet — this is the id an Exchange
                account for this person would use, not confirmation one exists.
              </p>
            </section>
          )}
        </div>
      )}

      {tab === 'vault' && (
        <LightDataTable
          rows={profile.dnaRecords ?? []}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r: any) => r.imageFilename },
            { key: 'type', header: 'Type', render: (r: any) => r.fileType },
            { key: 'status', header: 'Status', render: (r: any) => <LightStatusBadge value={r.status} /> },
            { key: 'size', header: 'Size', render: (r: any) => formatBytes(r.imageSizeBytes) },
            { key: 'hash', header: 'SHA-256', className: 'font-mono text-xs max-w-[120px] truncate', render: (r: any) => r.sha256Hash?.slice(0, 16) + '…' },
            { key: 'vault', header: 'Encrypted', render: (r: any) => r.vaultRecord ? formatBytes(r.vaultRecord.encryptedSizeBytes) : '—' },
            { key: 'created', header: 'Created', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {tab === 'certificates' && (
        <LightDataTable
          rows={profile.certificates ?? []}
          keyField="id"
          columns={[
            { key: 'id', header: 'Certificate ID', render: (r: any) => <span className="font-mono text-xs">{r.certificateId}</span> },
            { key: 'status', header: 'Status', render: (r: any) => <LightStatusBadge value={r.status} /> },
            { key: 'created', header: 'Issued', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
            { key: 'revoked', header: 'Revoked', render: (r: any) => r.revokedAt ? format(new Date(r.revokedAt), 'MMM d, yyyy') : '—' },
          ]}
        />
      )}

      {tab === 'shares' && (
        <LightDataTable
          rows={profile.shareLinks ?? []}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r: any) => r.filename },
            { key: 'status', header: 'Status', render: (r: any) => <LightStatusBadge value={r.isActive ? 'ACTIVE' : 'REVOKED'} /> },
            { key: 'views', header: 'Views', render: (r: any) => r.viewCount },
            { key: 'downloads', header: 'Downloads', render: (r: any) => r.downloadCount },
            { key: 'access', header: 'Access Logs', render: (r: any) => r._count?.accessLogs ?? 0 },
            { key: 'created', header: 'Created', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {tab === 'tep' && (
        <LightDataTable
          rows={profile.tepPackages ?? []}
          keyField="id"
          columns={[
            { key: 'id', header: 'Package ID', render: (r: any) => <span className="font-mono text-xs">{r.id.slice(0, 12)}…</span> },
            { key: 'status', header: 'Status', render: (r: any) => <LightStatusBadge value={r.status} /> },
            { key: 'created', header: 'Created', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {tab === 'logins' && (
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-900">Active Sessions</h3>
              {isOwner && (profile.userSessions ?? []).some((s: any) => !s.revokedAt) && (
                <button
                  type="button"
                  onClick={handleSignOutEverywhere}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                >
                  <LogOut size={13} /> Sign out everywhere
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              Revoking marks a session invalid and removes this user's refresh tokens — a live access token
              stays valid until its own 7-day expiry (stateless JWT; there's no per-request session check yet).
            </p>
            <LightDataTable
              rows={profile.userSessions ?? []}
              keyField="id"
              emptyMessage="No sessions recorded"
              columns={[
                { key: 'ip', header: 'IP', render: (r: any) => <span className="font-mono text-xs">{r.ip ?? '—'}</span> },
                { key: 'agent', header: 'User Agent', className: 'max-w-[220px] truncate', render: (r: any) => <span className="text-xs">{r.userAgent ?? '—'}</span> },
                { key: 'created', header: 'Started', render: (r: any) => format(new Date(r.createdAt), 'MMM d, HH:mm') },
                { key: 'active', header: 'Last Active', render: (r: any) => format(new Date(r.lastActiveAt), 'MMM d, HH:mm') },
                {
                  key: 'status',
                  header: 'Status',
                  render: (r: any) => (
                    <LightStatusBadge value={r.revokedAt ? 'REVOKED' : new Date(r.expiresAt) < new Date() ? 'INACTIVE' : 'ACTIVE'} />
                  ),
                },
                {
                  key: 'action',
                  header: '',
                  render: (r: any) =>
                    isOwner && !r.revokedAt ? (
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(r.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Revoke
                      </button>
                    ) : null,
                },
              ]}
            />
          </section>

          <section>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Devices</h3>
            <LightDataTable
              rows={profile.userDevices ?? []}
              keyField="id"
              emptyMessage="No devices recorded"
              columns={[
                { key: 'label', header: 'Device', render: (r: any) => r.deviceLabel ?? 'Unlabeled device' },
                { key: 'fingerprint', header: 'Fingerprint', className: 'font-mono text-xs', render: (r: any) => r.deviceFingerprint?.slice(0, 16) + '…' },
                { key: 'registered', header: 'Registered', render: (r: any) => format(new Date(r.registeredAt), 'MMM d, yyyy') },
                { key: 'seen', header: 'Last Seen', render: (r: any) => format(new Date(r.lastSeenAt), 'MMM d, HH:mm') },
                { key: 'trusted', header: 'Trust', render: (r: any) => <LightStatusBadge value={r.isTrusted ? 'ACTIVE' : 'INACTIVE'} /> },
                {
                  key: 'action',
                  header: '',
                  render: (r: any) =>
                    isOwner ? (
                      <button
                        type="button"
                        onClick={() => handleUntrustDevice(r.id, r.isTrusted)}
                        className="text-xs text-gray-600 hover:underline"
                      >
                        {r.isTrusted ? 'Mark untrusted' : 'Mark trusted'}
                      </button>
                    ) : null,
                },
              ]}
            />
          </section>

          <section>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Login History</h3>
            <LightDataTable
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
          </section>
        </div>
      )}

      {tab === 'monitoring' && (
        <LightDataTable
          rows={profile.monitorRecords ?? []}
          keyField="id"
          columns={[
            { key: 'type', header: 'Scan Type', render: (r: any) => r.scanType },
            { key: 'status', header: 'Status', render: (r: any) => <LightStatusBadge value={r.status} /> },
            { key: 'last', header: 'Last Checked', render: (r: any) => r.lastCheckedAt ? format(new Date(r.lastCheckedAt), 'MMM d HH:mm') : '—' },
            { key: 'created', header: 'Created', render: (r: any) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}
    </div>
  );
}
