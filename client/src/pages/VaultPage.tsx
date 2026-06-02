import { useState } from 'react';
import { Archive, Search, Lock, RefreshCw, Download, Eye, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useApi, formatBytes } from '../hooks/useApi';
import { listVaultRecords, retrieveFromVault } from '../services/dashboard.api';
import { SkeletonTable } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import type { VaultRecord } from '../types/dashboard.types';

function VaultDetailModal({ record, onClose }: { record: VaultRecord; onClose: () => void }) {
  const [retrieving, setRetrieving] = useState(false);

  const handleRetrieve = async () => {
    setRetrieving(true);
    try {
      const blob = await retrieveFromVault(record.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = record.originalFileName;
      a.click(); URL.revokeObjectURL(url);
      toast.success('File retrieved and decrypted successfully');
    } catch {
      toast.error('Failed to retrieve file from vault');
    } finally {
      setRetrieving(false);
    }
  };

  return (
    <Modal open title="Vault Record Details" onClose={onClose} size="lg">
      <div className="p-6 space-y-4">
        {/* File info */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Vault ID',            value: record.id,                     mono: true,  accent: true  },
            { label: 'DNA Record ID',        value: record.dnaRecordId,            mono: true,  accent: true  },
            { label: 'Original File',        value: record.originalFileName,       mono: false, accent: false },
            { label: 'MIME Type',            value: record.originalMimeType,       mono: true,  accent: false },
            { label: 'Original Size',        value: formatBytes(record.originalSizeBytes), mono: true, accent: false },
            { label: 'Encrypted Size',       value: formatBytes(record.encryptedSizeBytes), mono: true, accent: false },
            { label: 'Encryption',           value: record.encryptionAlgorithm,    mono: true,  accent: false },
            { label: 'Key Derivation',       value: record.keyDerivation,          mono: true,  accent: false },
            { label: 'Stored At',            value: format(new Date(record.createdAt), 'PPpp'), mono: false, accent: false },
          ].map(row => (
            <div key={row.label} className="bg-bg-elevated rounded-lg p-3">
              <p className="text-2xs text-gray-500 mono mb-1">{row.label}</p>
              <p className={`text-xs break-all ${row.mono ? 'mono' : ''} ${row.accent ? 'text-dna-400' : 'text-gray-200'}`}>
                {row.value}
              </p>
            </div>
          ))}
        </div>

        {/* Security info */}
        <div className="rounded-xl bg-success/5 border border-success/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} className="text-success" />
            <p className="text-xs font-semibold text-success">Encryption Details</p>
          </div>
          <p className="text-2xs text-gray-400">
            File is encrypted with AES-256-GCM. The encryption key is NEVER stored —
            it is re-derived on demand from the Vault ID using HKDF-SHA256.
            The authentication tag ensures tamper detection during decryption.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleRetrieve}
            disabled={retrieving}
            className="btn btn-primary flex-1"
          >
            {retrieving ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            {retrieving ? 'Decrypting…' : 'Retrieve & Decrypt'}
          </button>
          <button onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function VaultPage() {
  const { data: records, loading, error, refetch } = useApi(listVaultRecords);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<VaultRecord | null>(null);

  const filtered = (records ?? []).filter(r =>
    r.originalFileName.toLowerCase().includes(search.toLowerCase()) ||
    r.id.toLowerCase().includes(search.toLowerCase()) ||
    r.dnaRecordId.toLowerCase().includes(search.toLowerCase())
  );

  if (error) return (
    <div className="flex items-center justify-center h-64 text-center">
      <div>
        <p className="text-danger text-sm mb-3">{error}</p>
        <button onClick={refetch} className="btn btn-secondary btn-sm">
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Vault Explorer</h1>
          <p className="text-sm text-gray-500 mt-0.5">AES-256-GCM encrypted file storage</p>
        </div>
        <div className="flex items-center gap-3">
          {!loading && records && (
            <div className="flex items-center gap-2">
              <Badge variant="purple">{records.length} records</Badge>
              <Badge variant="success" dot>AES-256-GCM</Badge>
            </div>
          )}
          <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      {!loading && records && records.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-purple">{records.length}</p>
            <p className="text-2xs text-gray-500 mt-1">Encrypted Files</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-success">
              {formatBytes(records.reduce((s, r) => s + r.encryptedSizeBytes, 0))}
            </p>
            <p className="text-2xs text-gray-500 mt-1">Total Encrypted Size</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-dna-400">100%</p>
            <p className="text-2xs text-gray-500 mt-1">Encryption Coverage</p>
          </div>
        </div>
      )}

      {/* Search + table */}
      <div className="card overflow-hidden p-0">
        <div className="flex items-center gap-3 p-4 border-b border-bg-border">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search by filename, vault ID, or DNA record ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9 text-sm"
            />
          </div>
          <Archive size={16} className="text-gray-500 shrink-0" />
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Vault ID</th>
                <th>Original Size</th>
                <th>Encryption</th>
                <th>Stored At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTable rows={5} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={Archive}
                      title="No vault records"
                      description="Encrypt and store files using the Generate DNA flow"
                    />
                  </td>
                </tr>
              ) : (
                filtered.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Lock size={12} className="text-success shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-white truncate max-w-[200px]">
                            {r.originalFileName}
                          </p>
                          <p className="text-2xs text-gray-500 mono">{r.originalMimeType}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="mono text-2xs text-dna-400">{r.id.slice(0, 16)}…</span>
                    </td>
                    <td>
                      <span className="mono text-xs">{formatBytes(r.originalSizeBytes)}</span>
                    </td>
                    <td>
                      <Badge variant="success">{r.encryptionAlgorithm}</Badge>
                    </td>
                    <td>
                      <span className="text-xs text-gray-400">
                        {format(new Date(r.createdAt), 'MMM d, yyyy · HH:mm')}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelected(r)}
                          className="btn-ghost btn-icon text-gray-500 hover:text-white"
                          title="View details"
                        >
                          <Eye size={14} />
                        </button>
                        <a
                          href={`/api/v1/dna/${r.dnaRecordId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-ghost btn-icon text-gray-500 hover:text-dna-400"
                          title="Open DNA record"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <VaultDetailModal record={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
