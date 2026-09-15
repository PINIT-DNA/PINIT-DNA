import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { fetchAllDna } from '../api/super-admin.api';

export function AdminDnaPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const highlight = searchParams.get('highlight');

  useEffect(() => {
    setLoading(true);
    fetchAllDna({ status: status || undefined })
      .then((d) => setRecords(d.records ?? []))
      .finally(() => setLoading(false));
  }, [status]);

  const visible = highlight ? records.filter((r) => r.id === highlight) : records;

  return (
    <div>
      {highlight && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-md border border-indigo-200 bg-indigo-50 text-sm text-indigo-700 w-fit">
          Showing 1 record from search
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="p-0.5 rounded hover:bg-indigo-100"
            title="Clear filter"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {!highlight && (
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="mb-4 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
          <option value="DELETED">Deleted</option>
        </select>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : (
        <LightDataTable
          rows={visible}
          keyField="id"
          emptyMessage={highlight ? 'That record could not be found' : 'No records found'}
          columns={[
            { key: 'file', header: 'File', render: (r) => r.imageFilename },
            { key: 'owner', header: 'Owner', render: (r) => r.ownerUser?.shortId },
            { key: 'type', header: 'File Type', render: (r) => r.fileType },
            { key: 'status', header: 'DNA Status', render: (r) => <LightStatusBadge value={r.status} /> },
            { key: 'vault', header: 'Vault', render: (r) => r.vaultRecord ? 'Linked' : '—' },
            { key: 'hash', header: 'SHA-256', className: 'font-mono text-xs', render: (r) => r.sha256Hash?.slice(0, 16) + '…' },
            { key: 'created', header: 'Generated', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy HH:mm') },
          ]}
        />
      )}
    </div>
  );
}
