import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { fetchInvestigations } from '../api/super-admin.api';

export function InvestigationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInvestigations()
      .then((d) => setItems(d.investigations ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="Investigation Center"
        description="Unified forensic investigations across all tenants"
      />

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <DataTable
          rows={items}
          keyField="id"
          columns={[
            { key: 'type', header: 'Event', render: (r) => <StatusBadge value={r.eventType ?? 'INVESTIGATED'} /> },
            { key: 'dna', header: 'DNA Record', render: (r) => <span className="font-mono text-xs">{r.dnaRecordId?.slice(0, 12) ?? '—'}…</span> },
            { key: 'user', header: 'User', render: (r) => r.ownerUserId?.slice(0, 12) ?? '—' },
            { key: 'verdict', header: 'Verdict', render: (r) => {
              const meta = r.metadata as Record<string, unknown> | null;
              return (meta?.verdict as string) ?? (meta?.status as string) ?? '—';
            }},
            { key: 'time', header: 'Timestamp', render: (r) => r.createdAt ? format(new Date(r.createdAt), 'MMM d, yyyy HH:mm') : '—' },
          ]}
        />
      )}
    </div>
  );
}
