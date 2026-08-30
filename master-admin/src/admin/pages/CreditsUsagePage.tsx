import { useEffect, useState } from 'react';
import { Database, AlertTriangle, HardDrive } from 'lucide-react';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatCard } from '../components/LightStatCard';
import { fetchUsageOverview } from '../api/super-admin.api';
import type { UsageRow } from '../api/super-admin.api';
import { formatBytes } from '../../hooks/useApi';

function UsageBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-gray-400">Unlimited</span>;
  const color = pct >= 90 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  );
}

export function CreditsUsagePage() {
  const [data, setData] = useState<{ usage: UsageRow[]; totalUsedBytes: number; nearLimitCount: number; metered: { usageRecordCount: number } } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsageOverview()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <LightStatCard label="Total Storage Used" value={formatBytes(data?.totalUsedBytes ?? 0)} icon={HardDrive} />
        <LightStatCard label="Subscriptions" value={data?.usage.length ?? 0} icon={Database} />
        <LightStatCard label="Near Plan Limit (80%+)" value={data?.nearLimitCount ?? 0} icon={AlertTriangle} />
      </div>

      <p className="text-xs text-gray-500">
        Storage usage is computed live from real vault records. Per-metric usage credits (investigation runs, monitor enrollments, API calls) have{' '}
        {data?.metered.usageRecordCount ? `${data.metered.usageRecordCount} recorded events` : 'no recorded events yet — nothing in the platform writes to that ledger yet'}.
      </p>

      <LightDataTable
        rows={data?.usage ?? []}
        keyField="userId"
        emptyMessage="No subscriptions found"
        columns={[
          { key: 'user', header: 'User', render: (r: UsageRow) => <span className="font-mono text-xs">{r.user?.shortId ?? '—'}</span> },
          { key: 'plan', header: 'Plan', render: (r: UsageRow) => r.planName },
          { key: 'used', header: 'Used', render: (r: UsageRow) => formatBytes(Number(r.usedBytes)) },
          { key: 'limit', header: 'Limit', render: (r: UsageRow) => r.limitBytes ? formatBytes(Number(r.limitBytes)) : 'Unlimited' },
          { key: 'pct', header: 'Usage', render: (r: UsageRow) => <UsageBar pct={r.usagePct} /> },
        ]}
      />
    </div>
  );
}
