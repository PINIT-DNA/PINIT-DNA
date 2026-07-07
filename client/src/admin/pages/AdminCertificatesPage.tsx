import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { fetchAllCertificates } from '../api/super-admin.api';
import { exportCertificatePDF, exportDNACertificateJSON } from '../../services/report-generator';
import type { VaultRecord } from '../../types/dashboard.types';

type CertRow = {
  id: string;
  certificateId: string;
  status: string;
  createdAt: string;
  revokedAt: string | null;
  ownerUser: { shortId: string; fullName: string | null };
  dnaRecord: { id: string; imageFilename: string; fileType: string } | null;
  vaultRecord: {
    id: string;
    dnaRecordId: string;
    originalFileName: string;
    originalMimeType: string;
    originalSizeBytes: number;
    encryptedSizeBytes: number;
    encryptionAlgorithm: string;
    keyDerivation: string;
    createdAt: string;
  } | null;
};

function toVaultRecord(row: CertRow): VaultRecord | null {
  const v = row.vaultRecord;
  if (!v) return null;
  return {
    id: v.id,
    dnaRecordId: v.dnaRecordId,
    originalFileName: v.originalFileName,
    originalMimeType: v.originalMimeType,
    originalSizeBytes: v.originalSizeBytes,
    encryptedSizeBytes: v.encryptedSizeBytes,
    encryptionAlgorithm: v.encryptionAlgorithm,
    keyDerivation: v.keyDerivation ?? 'PBKDF2',
    createdAt: v.createdAt,
    dnaRecord: {
      id: row.dnaRecord?.id ?? v.dnaRecordId,
      status: 'COMPLETE',
      filename: row.dnaRecord?.imageFilename ?? v.originalFileName,
    },
  };
}

export function AdminCertificatesPage() {
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchAllCertificates({ status: status || undefined })
      .then((d) => setCerts(d.certificates as CertRow[]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [status]);

  const handlePdf = async (row: CertRow) => {
    const vault = toVaultRecord(row);
    if (!vault) {
      toast.error('Vault data not available');
      return;
    }
    setExportingId(row.id);
    toast.loading('Generating PDF…');
    try {
      await exportCertificatePDF(vault);
      toast.dismiss();
      toast.success('PDF downloaded');
    } catch {
      toast.dismiss();
      toast.error('PDF generation failed');
    } finally {
      setExportingId(null);
    }
  };

  const handleJson = (row: CertRow) => {
    const vault = toVaultRecord(row);
    if (!vault) {
      toast.error('Vault data not available');
      return;
    }
    exportDNACertificateJSON(vault);
    toast.success('JSON exported');
  };

  return (
    <div>
      <PageHeader
        title="Certificate Center"
        description="Issue, verify, audit and download certificates — same as user dashboard"
        actions={
          <button type="button" onClick={load} className="px-3 py-1.5 text-sm border border-zinc-700 rounded hover:bg-zinc-900 text-zinc-300 flex items-center gap-1">
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="mb-4 px-3 py-2 bg-[#111113] border border-zinc-800 rounded-md text-sm text-zinc-300"
      >
        <option value="">All statuses</option>
        <option value="ACTIVE">Active</option>
        <option value="REVOKED">Revoked</option>
      </select>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <DataTable
          rows={certs}
          keyField="id"
          columns={[
            { key: 'certId', header: 'Certificate ID', render: (r) => <span className="font-mono text-xs">{r.certificateId}</span> },
            { key: 'owner', header: 'Owner', render: (r) => r.ownerUser?.shortId },
            { key: 'file', header: 'File', render: (r) => r.dnaRecord?.imageFilename ?? '—' },
            { key: 'type', header: 'File Type', render: (r) => r.dnaRecord?.fileType ?? '—' },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
            { key: 'issued', header: 'Issued', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy') },
            { key: 'revoked', header: 'Revoked', render: (r) => r.revokedAt ? format(new Date(r.revokedAt), 'MMM d, yyyy') : '—' },
            { key: 'actions', header: 'Download', render: (r) => (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={r.status === 'REVOKED' || exportingId === r.id}
                  onClick={() => handlePdf(r)}
                  className="px-2 py-1 text-xs rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-40 flex items-center gap-1"
                  title="Download PDF Certificate"
                >
                  {exportingId === r.id ? <RefreshCw size={12} className="animate-spin" /> : <FileText size={12} />}
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => handleJson(r)}
                  className="px-2 py-1 text-xs rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 flex items-center gap-1"
                  title="Export JSON"
                >
                  <Download size={12} /> JSON
                </button>
              </div>
            )},
          ]}
        />
      )}
    </div>
  );
}
