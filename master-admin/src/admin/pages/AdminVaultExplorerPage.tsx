import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Search, Share2, ShieldCheck, FileSearch, Clock, MapPin, User,
} from 'lucide-react';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { LightStatCard } from '../components/LightStatCard';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white border border-gray-200 rounded-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm">Close</button>
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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <LightStatCard label="Vault Assets" value={files.length} icon={Database} />
        <LightStatCard label="Total Storage" value={formatBytes(totalSize)} icon={Database} />
      </div>

      <div className="relative max-w-md mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          placeholder="Search files or owner..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : (
        <LightDataTable
          rows={files}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r) => <span className="max-w-[180px] truncate block">{r.originalFileName}</span> },
            { key: 'owner', header: 'Owner', render: (r) => (
              <button type="button" className="font-mono text-xs text-indigo-600 hover:underline" onClick={(e) => { e.stopPropagation(); if (r.dnaRecord?.ownerUserId) navigate(`/users/${r.dnaRecord.ownerUserId}`); }}>
                {r.dnaRecord?.ownerUser?.shortId ?? '—'}
              </button>
            )},
            { key: 'type', header: 'Type', render: (r) => r.dnaRecord?.fileType },
            { key: 'status', header: 'DNA', render: (r) => <LightStatusBadge value={r.dnaRecord?.status ?? '—'} /> },
            { key: 'size', header: 'Size', render: (r) => formatBytes(r.originalSizeBytes) },
            { key: 'created', header: 'Created', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy') },
            { key: 'actions', header: 'Actions', render: (r) => (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button type="button" title="Intelligence Report" onClick={() => navigate(`/intelligence/${r.id}`)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-purple-600"><FileSearch size={14} /></button>
                <button type="button" title="Protected Downloads / TEP" onClick={() => openTracking(r)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-emerald-600"><ShieldCheck size={14} /></button>
                <button type="button" title="Share Links" onClick={() => openShares(r)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600"><Share2 size={14} /></button>
                <button type="button" title="Activity Timeline" onClick={() => navigate(`/vault/${r.id}/timeline`)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600"><Clock size={14} /></button>
                <button type="button" title="Tracking Map" onClick={() => openTracking(r)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-cyan-600"><MapPin size={14} /></button>
                <button type="button" title="Owner Profile" onClick={() => r.dnaRecord?.ownerUserId && navigate(`/users/${r.dnaRecord.ownerUserId}`)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"><User size={14} /></button>
              </div>
            )},
          ]}
        />
      )}

      {trackingModal && (
        <Modal title={`Protected Downloads — ${trackingModal.originalFileName}`} onClose={() => { setTrackingModal(null); setTrackingData(null); }}>
          {modalLoading ? <p className="text-sm text-gray-500">Loading…</p> : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-gray-500">TEP Packages</span><p className="text-gray-900">{trackingData?.tepPackages?.length ?? 0}</p></div>
                <div><span className="text-gray-500">Downloads</span><p className="text-gray-900">{trackingData?.downloads?.length ?? 0}</p></div>
              </div>
              {(trackingData?.tepPackages ?? []).map((t: any) => (
                <div key={t.tepCode ?? t.id} className="border border-gray-200 rounded p-3">
                  <p className="font-mono text-xs text-emerald-600">{t.tepCode ?? t.id}</p>
                  <p className="text-gray-500 text-xs">{t.status} · {t.createdAt ? format(new Date(t.createdAt), 'MMM d HH:mm') : ''}</p>
                </div>
              ))}
              {(trackingData?.chainOfCustody ?? []).slice(0, 10).map((c: any, i: number) => (
                <div key={i} className="border-l-2 border-gray-200 pl-3 text-xs text-gray-500">
                  <p className="text-gray-900">{c.step ?? c.eventType}</p>
                  <p>{c.timestamp ? format(new Date(c.timestamp), 'MMM d HH:mm') : ''}</p>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {sharesModal && (
        <Modal title={`Share Links — ${sharesModal.originalFileName}`} onClose={() => { setSharesModal(null); setSharesData(null); }}>
          {modalLoading ? <p className="text-sm text-gray-500">Loading…</p> : (
            <div className="space-y-3">
              {(sharesData ?? []).length === 0 && <p className="text-sm text-gray-500">No share links</p>}
              {(sharesData ?? []).map((link: any) => (
                <div key={link.id} className="border border-gray-200 rounded p-3 text-sm">
                  <p className="text-gray-900">{link.filename}</p>
                  <p className="font-mono text-xs text-gray-500 truncate">{link.token}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {link.isActive ? 'Active' : 'Revoked'} · {link.viewCount} views · {link.downloadCount} downloads
                  </p>
                  {(link.accessLogs ?? []).slice(0, 3).map((log: any) => (
                    <p key={log.id} className="text-[11px] text-gray-400">{log.action} · {log.ipAddress} · {format(new Date(log.createdAt), 'MMM d HH:mm')}</p>
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
