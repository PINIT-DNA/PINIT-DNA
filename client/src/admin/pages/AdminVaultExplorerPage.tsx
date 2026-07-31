import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Search, Share2, ShieldCheck, FileSearch, Clock, MapPin, User,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { StatCard } from '../components/StatCard';
import { fetchAllVault, fetchVaultTracking, fetchVaultShares } from '../api/super-admin.api';
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
    ownerUserId: string | null;
    ownerUser: { shortId: string; fullName: string | null; id?: string };
  };
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-[#111113] border border-zinc-800 rounded-lg w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-sm">Close</button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function AdminVaultExplorerPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<VaultRow[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [trackingModal, setTrackingModal] = useState<VaultRow | null>(null);
  const [sharesModal, setSharesModal] = useState<VaultRow | null>(null);
  const [trackingData, setTrackingData] = useState<any>(null);
  const [sharesData, setSharesData] = useState<any>(null);
  const [modalLoading, setModalLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchAllVault({ q: q || undefined })
      .then((d) => {
        setFiles(d.files as VaultRow[]);
        setTotalSize(d.totalSize ?? 0);
      })
      .finally(() => setLoading(false));
  }, [q]);

  const openTracking = async (row: VaultRow) => {
    setTrackingModal(row);
    setModalLoading(true);
    try {
      const d = await fetchVaultTracking(row.id) as { tracking?: unknown };
      setTrackingData(d.tracking);
    } finally {
      setModalLoading(false);
    }
  };

  const openShares = async (row: VaultRow) => {
    setSharesModal(row);
    setModalLoading(true);
    try {
      const d = await fetchVaultShares(row.id) as { links?: unknown[] };
      setSharesData(d.links);
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Vault Explorer"
        description="Enterprise vault — same actions as user dashboard, cross-tenant view"
      />

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
            { key: 'file', header: 'File', render: (r) => <span className="max-w-[180px] truncate block">{r.originalFileName}</span> },
            { key: 'owner', header: 'Owner', render: (r) => (
              <button type="button" className="font-mono text-xs text-dna-400 hover:underline" onClick={(e) => { e.stopPropagation(); if (r.dnaRecord?.ownerUserId) navigate(`/admin/users/${r.dnaRecord.ownerUserId}`); }}>
                {r.dnaRecord?.ownerUser?.shortId ?? '—'}
              </button>
            )},
            { key: 'type', header: 'Type', render: (r) => r.dnaRecord?.fileType },
            { key: 'status', header: 'DNA', render: (r) => <StatusBadge value={r.dnaRecord?.status ?? '—'} /> },
            { key: 'size', header: 'Size', render: (r) => formatBytes(r.originalSizeBytes) },
            { key: 'created', header: 'Created', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy') },
            { key: 'actions', header: 'Actions', render: (r) => (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button type="button" title="Intelligence Report" onClick={() => navigate(`/admin/intelligence/${r.id}`)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-purple-400"><FileSearch size={14} /></button>
                <button type="button" title="Protected Downloads / TEP" onClick={() => openTracking(r)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400"><ShieldCheck size={14} /></button>
                <button type="button" title="Share Links" onClick={() => openShares(r)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-blue-400"><Share2 size={14} /></button>
                <button type="button" title="Activity Timeline" onClick={() => navigate(`/admin/vault/${r.id}/timeline`)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-amber-400"><Clock size={14} /></button>
                <button type="button" title="Tracking Map" onClick={() => openTracking(r)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-cyan-400"><MapPin size={14} /></button>
                <button type="button" title="Owner Profile" onClick={() => r.dnaRecord?.ownerUserId && navigate(`/admin/users/${r.dnaRecord.ownerUserId}`)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"><User size={14} /></button>
              </div>
            )},
          ]}
        />
      )}

      {trackingModal && (
        <Modal title={`Protected Downloads — ${trackingModal.originalFileName}`} onClose={() => { setTrackingModal(null); setTrackingData(null); }}>
          {modalLoading ? <p className="text-sm text-zinc-500">Loading…</p> : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-zinc-500">TEP Packages</span><p className="text-zinc-200">{trackingData?.tepPackages?.length ?? 0}</p></div>
                <div><span className="text-zinc-500">Downloads</span><p className="text-zinc-200">{trackingData?.downloads?.length ?? 0}</p></div>
              </div>
              {(trackingData?.tepPackages ?? []).map((t: any) => (
                <div key={t.tepCode ?? t.id} className="border border-zinc-800 rounded p-3">
                  <p className="font-mono text-xs text-emerald-400">{t.tepCode ?? t.id}</p>
                  <p className="text-zinc-500 text-xs">{t.status} · {t.createdAt ? format(new Date(t.createdAt), 'MMM d HH:mm') : ''}</p>
                </div>
              ))}
              {(trackingData?.chainOfCustody ?? []).slice(0, 10).map((c: any, i: number) => (
                <div key={i} className="border-l-2 border-zinc-700 pl-3 text-xs text-zinc-400">
                  <p className="text-zinc-200">{c.step ?? c.eventType}</p>
                  <p>{c.timestamp ? format(new Date(c.timestamp), 'MMM d HH:mm') : ''}</p>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {sharesModal && (
        <Modal title={`Share Links — ${sharesModal.originalFileName}`} onClose={() => { setSharesModal(null); setSharesData(null); }}>
          {modalLoading ? <p className="text-sm text-zinc-500">Loading…</p> : (
            <div className="space-y-3">
              {(sharesData ?? []).length === 0 && <p className="text-sm text-zinc-500">No share links</p>}
              {(sharesData ?? []).map((link: any) => (
                <div key={link.id} className="border border-zinc-800 rounded p-3 text-sm">
                  <p className="text-zinc-200">{link.filename}</p>
                  <p className="font-mono text-xs text-zinc-500 truncate">{link.token}</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {link.isActive ? 'Active' : 'Revoked'} · {link.viewCount} views · {link.downloadCount} downloads
                  </p>
                  {(link.accessLogs ?? []).slice(0, 3).map((log: any) => (
                    <p key={log.id} className="text-[11px] text-zinc-600">{log.action} · {log.ipAddress} · {format(new Date(log.createdAt), 'MMM d HH:mm')}</p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
