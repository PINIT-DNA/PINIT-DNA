import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { LightStatCard } from '../components/LightStatCard';
import { fetchMonitoring } from '../api/super-admin.api';
import { Radar, AlertTriangle, Play } from 'lucide-react';

export function AdminMonitoringPage() {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'monitors' | 'alerts' | 'runs'>('monitors');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMonitoring()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const activeMonitors = (data?.monitors ?? []).filter((m: any) => m.status === 'ACTIVE').length;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <LightStatCard label="Active Monitors" value={activeMonitors} icon={Radar} />
        <LightStatCard label="Crawl Alerts" value={data?.alerts?.length ?? 0} icon={AlertTriangle} />
        <LightStatCard label="Recent Runs" value={data?.runs?.length ?? 0} icon={Play} />
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {(['monitors', 'alerts', 'runs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px ${
              tab === t ? 'border-indigo-600 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : tab === 'monitors' ? (
        <LightDataTable
          rows={data?.monitors ?? []}
          keyField="id"
          columns={[
            { key: 'owner', header: 'Owner', render: (r) => r.ownerUser?.shortId },
            { key: 'file', header: 'File', render: (r) => r.dnaRecord?.imageFilename ?? '—' },
            { key: 'type', header: 'Scan Type', render: (r) => r.scanType },
            { key: 'status', header: 'Status', render: (r) => <LightStatusBadge value={r.status} /> },
            { key: 'last', header: 'Last Checked', render: (r) => r.lastCheckedAt ? format(new Date(r.lastCheckedAt), 'MMM d HH:mm') : '—' },
          ]}
        />
      ) : tab === 'alerts' ? (
        <LightDataTable
          rows={data?.alerts ?? []}
          keyField="id"
          columns={[
            { key: 'url', header: 'URL', render: (r) => <span className="max-w-[300px] truncate block">{r.url ?? r.sourceUrl ?? '—'}</span> },
            { key: 'owner', header: 'Owner', render: (r) => r.monitorRecord?.ownerUser?.shortId ?? '—' },
            { key: 'match', header: 'Match Score', render: (r) => r.matchScore ?? r.similarity ?? '—' },
            { key: 'time', header: 'Detected', render: (r) => r.createdAt ? format(new Date(r.createdAt), 'MMM d HH:mm') : '—' },
          ]}
        />
      ) : (
        <LightDataTable
          rows={data?.runs ?? []}
          keyField="id"
          columns={[
            { key: 'status', header: 'Status', render: (r) => <LightStatusBadge value={r.status ?? 'PENDING'} /> },
            { key: 'started', header: 'Started', render: (r) => r.startedAt ? format(new Date(r.startedAt), 'MMM d HH:mm') : '—' },
            { key: 'ended', header: 'Ended', render: (r) => r.completedAt ? format(new Date(r.completedAt), 'MMM d HH:mm') : '—' },
            { key: 'found', header: 'Matches', render: (r) => r.matchesFound ?? '—' },
          ]}
        />
      )}
    </div>
  );
}
