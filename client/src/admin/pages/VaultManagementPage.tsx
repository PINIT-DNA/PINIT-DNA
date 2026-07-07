import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { format } from 'date-fns';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { StatCard } from '../components/StatCard';
import { fetchAllVault } from '../api/super-admin.api';
import { formatBytes } from '../../hooks/useApi';
import { Database } from 'lucide-react';

type VaultRow = {
  id: string;
  originalFileName: string;
  originalMimeType: string;
  originalSizeBytes: number;
  encryptedSizeBytes: number;
  encryptionAlgorithm: string;
  createdAt: string;
  dnaRecord: {
    id: string;
    sha256Hash: string;
    fileType: string;
    status: string;
    ownerUser: { shortId: string; fullName: string | null; organization: string | null; country: string | null };
  };
};

export function VaultManagementPage() {
  const [files, setFiles] = useState<VaultRow[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchAllVault({ q: q || undefined })
      .then((d) => {
        setFiles(d.files as VaultRow[]);
        setTotalSize(d.totalSize ?? 0);
      })
      .finally(() => setLoading(false));
  }, [q]);

  return (
    <div>
      <PageHeader title="Vault Management" description="All encrypted vault files across tenants" />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <StatCard label="Vault Files" value={files.length} icon={Database} />
        <StatCard label="Total Storage" value={formatBytes(totalSize)} icon={Database} />
      </div>

      <div className="relative max-w-md mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="search"
          placeholder="Search files or owner..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-[#111113] border border-zinc-800 rounded-md text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <DataTable
          rows={files}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r) => r.originalFileName },
            { key: 'owner', header: 'Owner', render: (r) => r.dnaRecord?.ownerUser?.shortId ?? '—' },
            { key: 'org', header: 'Organization', render: (r) => r.dnaRecord?.ownerUser?.organization ?? '—' },
            { key: 'country', header: 'Country', render: (r) => r.dnaRecord?.ownerUser?.country ?? '—' },
            { key: 'type', header: 'Type', render: (r) => r.dnaRecord?.fileType },
            { key: 'status', header: 'DNA Status', render: (r) => <StatusBadge value={r.dnaRecord?.status ?? '—'} /> },
            { key: 'algo', header: 'Encryption', render: (r) => r.encryptionAlgorithm },
            { key: 'size', header: 'Size', render: (r) => formatBytes(r.originalSizeBytes) },
            { key: 'enc', header: 'Encrypted', render: (r) => formatBytes(r.encryptedSizeBytes) },
            { key: 'created', header: 'Created', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}
    </div>
  );
}
