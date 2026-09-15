import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { fetchTracking } from '../api/super-admin.api';

export function TrackingPage() {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'access' | 'tep' | 'forensic'>('access');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTracking()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const tabs = [
    { id: 'access' as const, label: 'Share Access Logs', count: data?.accessLogs?.length ?? 0 },
    { id: 'tep' as const, label: 'TEP Packages', count: data?.tepPackages?.length ?? 0 },
    { id: 'forensic' as const, label: 'Forensic Downloads', count: data?.downloads?.length ?? 0 },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.id ? 'border-indigo-600 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : tab === 'access' ? (
        <LightDataTable
          rows={data?.accessLogs ?? []}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r) => r.shareLink?.filename ?? '—' },
            { key: 'owner', header: 'Owner', render: (r) => r.shareLink?.ownerUser?.shortId ?? '—' },
            { key: 'action', header: 'Action', render: (r) => r.action },
            { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ipAddress ?? '—'}</span> },
            { key: 'location', header: 'Location', render: (r) => [r.city, r.country].filter(Boolean).join(', ') || '—' },
            { key: 'time', header: 'Time', render: (r) => format(new Date(r.createdAt), 'MMM d HH:mm') },
          ]}
        />
      ) : tab === 'tep' ? (
        <LightDataTable
          rows={data?.tepPackages ?? []}
          keyField="id"
          columns={[
            { key: 'id', header: 'Package', render: (r) => <span className="font-mono text-xs">{r.id.slice(0, 16)}…</span> },
            { key: 'file', header: 'File', render: (r) => r.dnaRecord?.imageFilename ?? '—' },
            { key: 'status', header: 'Status', render: (r) => <LightStatusBadge value={r.status} /> },
            { key: 'created', header: 'Created', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      ) : (
        <LightDataTable
          rows={data?.downloads ?? []}
          keyField="id"
          columns={[
            { key: 'type', header: 'Event', render: (r) => r.eventType },
            { key: 'dna', header: 'DNA', render: (r) => <span className="font-mono text-xs">{r.dnaRecordId?.slice(0, 12) ?? '—'}…</span> },
            { key: 'time', header: 'Time', render: (r) => r.createdAt ? format(new Date(r.createdAt), 'MMM d HH:mm') : '—' },
          ]}
        />
      )}
    </div>
  );
}
