import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileSearch, Clock, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { fetchAllFiles } from '../api/super-admin.api';
import { formatBytes } from '../../hooks/useApi';

type FileRow = {
  id: string;
  imageFilename: string;
  imageMimeType: string;
  imageSizeBytes: number;
  fileType: string;
  sha256Hash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  ownerUser: { id: string; shortId: string; fullName: string | null; organization: string | null; country: string | null };
  vaultRecord: { id: string; encryptionAlgorithm: string } | null;
};

export function FileExplorerPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [q, setQ] = useState('');
  const [fileType, setFileType] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchAllFiles({ q: q || undefined, fileType: fileType || undefined })
      .then((d) => setFiles(d.files as FileRow[]))
      .finally(() => setLoading(false));
  }, [q, fileType]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search filename, hash, owner..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </div>
        <select
          value={fileType}
          onChange={(e) => setFileType(e.target.value)}
          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">All types</option>
          <option value="IMAGE">Image</option>
          <option value="VIDEO">Video</option>
          <option value="AUDIO">Audio</option>
          <option value="DOCUMENT">Document</option>
          <option value="ARCHIVE">Archive</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : (
        <LightDataTable
          rows={files}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r) => <span className="max-w-[180px] truncate block">{r.imageFilename}</span> },
            { key: 'owner', header: 'Owner', render: (r) => r.ownerUser?.shortId },
            { key: 'org', header: 'Institution', render: (r) => r.ownerUser?.organization ?? '—' },
            { key: 'dna', header: 'DNA', render: (r) => <LightStatusBadge value={r.status} /> },
            { key: 'hash', header: 'Hash', className: 'font-mono text-xs', render: (r) => r.sha256Hash?.slice(0, 12) + '…' },
            { key: 'protected', header: 'Protected', render: (r) => r.vaultRecord ? 'Yes' : 'No' },
            { key: 'type', header: 'Type', render: (r) => r.fileType },
            { key: 'size', header: 'Size', render: (r) => formatBytes(r.imageSizeBytes) },
            { key: 'created', header: 'Created', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy') },
            { key: 'actions', header: 'Actions', render: (r) => r.vaultRecord?.id ? (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button type="button" title="Intelligence Report" onClick={() => navigate(`/intelligence/${r.vaultRecord!.id}`)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-purple-600"><FileSearch size={14} /></button>
                <button type="button" title="Activity Timeline" onClick={() => navigate(`/vault/${r.vaultRecord!.id}/timeline`)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600"><Clock size={14} /></button>
                <button type="button" title="Open in Vault Explorer" onClick={() => navigate('/vault')} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"><ExternalLink size={14} /></button>
              </div>
            ) : <span className="text-gray-300 text-xs">—</span> },
          ]}
        />
      )}
    </div>
  );
}
