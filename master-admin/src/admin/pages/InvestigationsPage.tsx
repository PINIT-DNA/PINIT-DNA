import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
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
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : (
        <LightDataTable
          rows={items}
          keyField="id"
          columns={[
            { key: 'type', header: 'Event', render: (r) => <LightStatusBadge value={r.eventType ?? 'INVESTIGATED'} /> },
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
