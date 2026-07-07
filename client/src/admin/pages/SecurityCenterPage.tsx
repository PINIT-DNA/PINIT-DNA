import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { fetchExecutiveOverview, fetchAuditLogs } from '../api/super-admin.api';
import { Shield, AlertTriangle, Link2, Users } from 'lucide-react';
import { format } from 'date-fns';

export function SecurityCenterPage() {
  const [overview, setOverview] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchExecutiveOverview(), fetchAuditLogs()])
      .then(([o, a]) => { setOverview(o); setAudit(a); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Security Center" description="Platform security posture and threat indicators" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Logins Today" value={overview?.security?.loginsToday ?? 0} icon={Users} />
        <StatCard label="Active Sessions" value={overview?.security?.activeSessionsToday ?? 0} icon={Shield} />
        <StatCard label="Duplicate Attempts" value={overview?.security?.duplicateAttempts ?? 0} icon={AlertTriangle} />
        <StatCard label="Revoked Links" value={overview?.sharing?.revokedLinks ?? 0} icon={Link2} />
      </div>

      <section>
        <h2 className="text-sm font-medium text-zinc-200 mb-3">Recent Duplicate Upload Attempts</h2>
        <DataTable
          rows={audit?.duplicateAttempts ?? []}
          keyField="id"
          columns={[
            { key: 'uploader', header: 'PINIT User', render: (r) => <span className="font-mono text-xs">{r.uploader?.shortId ?? '—'}</span> },
            { key: 'file', header: 'File', render: (r) => r.filename ?? '—' },
            { key: 'owner', header: 'Original Owner', render: (r) => r.originalOwner?.shortId ?? '—' },
            { key: 'risk', header: 'Risk', render: (r) => r.riskLevel ? <StatusBadge value={r.riskLevel} /> : '—' },
            { key: 'time', header: 'Time', render: (r) => r.createdAt ? format(new Date(r.createdAt), 'MMM d HH:mm') : '—' },
          ]}
        />
      </section>
    </div>
  );
}
