import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { fetchAuditLogs } from '../api/super-admin.api';

export function AuditPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'logins' | 'share' | 'duplicate'>('logins');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAuditLogs()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Audit Logs" description="Security and access audit trail across the platform" />

      <div className="flex gap-1 border-b border-zinc-800 mb-6">
        {[
          { id: 'logins' as const, label: 'Login History' },
          { id: 'share' as const, label: 'Share Access' },
          { id: 'duplicate' as const, label: 'Duplicate Attempts' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.id ? 'border-zinc-100 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : tab === 'logins' ? (
        <DataTable
          rows={data?.logins ?? []}
          keyField="id"
          columns={[
            { key: 'user', header: 'User', render: (r) => r.user?.shortId ?? '—' },
            { key: 'method', header: 'Method', render: (r) => r.method },
            { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ip ?? '—'}</span> },
            { key: 'location', header: 'Location', render: (r) => [r.city, r.country].filter(Boolean).join(', ') || '—' },
            { key: 'success', header: 'Result', render: (r) => r.success ? 'Success' : 'Failed' },
            { key: 'time', header: 'Time', render: (r) => format(new Date(r.createdAt), 'MMM d HH:mm') },
          ]}
        />
      ) : tab === 'share' ? (
        <DataTable
          rows={data?.shareAccess ?? []}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r) => r.shareLink?.filename ?? '—' },
            { key: 'owner', header: 'Owner', render: (r) => r.shareLink?.ownerUser?.shortId ?? '—' },
            { key: 'action', header: 'Action', render: (r) => r.action },
            { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ipAddress ?? '—'}</span> },
            { key: 'time', header: 'Time', render: (r) => format(new Date(r.createdAt), 'MMM d HH:mm') },
          ]}
        />
      ) : (
        <DataTable
          rows={data?.duplicateAttempts ?? []}
          keyField="id"
          onRowClick={(r) => r.uploader?.id && navigate(`/admin/users/${r.uploader.id}`)}
          columns={[
            { key: 'uploader', header: 'PINIT User (Attempted)', render: (r) => (
              <span className="font-mono text-zinc-200">{r.uploader?.shortId ?? 'Not recorded'}</span>
            )},
            { key: 'file', header: 'Attempted File', render: (r) => <span className="max-w-[160px] truncate block">{r.filename ?? '—'}</span> },
            { key: 'existing', header: 'Existing File', render: (r) => <span className="max-w-[160px] truncate block">{r.existingFilename ?? '—'}</span> },
            { key: 'owner', header: 'Original Owner', render: (r) => <span className="font-mono text-xs">{r.originalOwner?.shortId ?? '—'}</span> },
            { key: 'match', header: 'Match', render: (r) => r.matchType ?? '—' },
            { key: 'risk', header: 'Risk', render: (r) => r.riskLevel ? <StatusBadge value={r.riskLevel} /> : '—' },
            { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ipAddress ?? '—'}</span> },
            { key: 'device', header: 'Device', render: (r) => [r.browser, r.os].filter(Boolean).join(' / ') || '—' },
            { key: 'time', header: 'Time', render: (r) => r.createdAt ? format(new Date(r.createdAt), 'MMM d HH:mm') : '—' },
          ]}
        />
      )}
    </div>
  );
}
