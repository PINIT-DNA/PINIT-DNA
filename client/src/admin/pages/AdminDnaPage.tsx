import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { fetchAllDna } from '../api/super-admin.api';

export function AdminDnaPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchAllDna({ status: status || undefined })
      .then((d) => setRecords(d.records ?? []))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div>
      <PageHeader title="DNA Engine" description="All DNA records generated across the platform" />

      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="mb-4 px-3 py-2 bg-[#111113] border border-zinc-800 rounded-md text-sm text-zinc-300"
      >
        <option value="">All statuses</option>
        <option value="ACTIVE">Active</option>
        <option value="ARCHIVED">Archived</option>
        <option value="DELETED">Deleted</option>
      </select>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <DataTable
          rows={records}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r) => r.imageFilename },
            { key: 'owner', header: 'Owner', render: (r) => r.ownerUser?.shortId },
            { key: 'type', header: 'File Type', render: (r) => r.fileType },
            { key: 'status', header: 'DNA Status', render: (r) => <StatusBadge value={r.status} /> },
            { key: 'vault', header: 'Vault', render: (r) => r.vaultRecord ? 'Linked' : '—' },
            { key: 'hash', header: 'SHA-256', className: 'font-mono text-xs', render: (r) => r.sha256Hash?.slice(0, 16) + '…' },
            { key: 'created', header: 'Generated', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy HH:mm') },
          ]}
        />
      )}
    </div>
  );
}
