import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { StatCard } from '../components/StatCard';
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
      <PageHeader title="Monitoring Center" description="Crawler status, leak monitoring, and threat intelligence" />

      <div className="stat-grid-3 gap-3 mb-6">
        <StatCard label="Active Monitors" value={activeMonitors} icon={Radar} />
        <StatCard label="Crawl Alerts" value={data?.alerts?.length ?? 0} icon={AlertTriangle} />
        <StatCard label="Recent Runs" value={data?.runs?.length ?? 0} icon={Play} />
      </div>

      <div className="flex gap-1 border-b border-zinc-800 mb-6">
        {(['monitors', 'alerts', 'runs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px ${
              tab === t ? 'border-zinc-100 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : tab === 'monitors' ? (
        <DataTable
          rows={data?.monitors ?? []}
          keyField="id"
          columns={[
            { key: 'owner', header: 'Owner', render: (r) => r.ownerUser?.shortId },
            { key: 'file', header: 'File', render: (r) => r.dnaRecord?.imageFilename ?? '—' },
            { key: 'type', header: 'Scan Type', render: (r) => r.scanType },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
            { key: 'last', header: 'Last Checked', render: (r) => r.lastCheckedAt ? format(new Date(r.lastCheckedAt), 'MMM d HH:mm') : '—' },
          ]}
        />
      ) : tab === 'alerts' ? (
        <DataTable
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
        <DataTable
          rows={data?.runs ?? []}
          keyField="id"
          columns={[
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status ?? 'PENDING'} /> },
            { key: 'started', header: 'Started', render: (r) => r.startedAt ? format(new Date(r.startedAt), 'MMM d HH:mm') : '—' },
            { key: 'ended', header: 'Ended', render: (r) => r.completedAt ? format(new Date(r.completedAt), 'MMM d HH:mm') : '—' },
            { key: 'found', header: 'Matches', render: (r) => r.matchesFound ?? '—' },
          ]}
        />
      )}
    </div>
  );
}
