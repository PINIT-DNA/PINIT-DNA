import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive, ShieldCheck, FileText, RefreshCw, Lock, Eye, Share2, Download,
  Image, FileVideo, Music, File, X, CheckCircle2, Copy, Loader2,
} from 'lucide-react';
import { AppHeader } from './parts';
import { listVaultRecords, retrieveFromVault } from '../../services/dashboard.api';
import { formatBytes } from '../../hooks/useApi';
import { API_BASE_URL } from '../../config/api.config';
import axios from 'axios';

interface VFile {
  id: string; name: string; mime: string; size: number; encSize: number;
  dnaRecordId: string; encryption: string; keyDerivation: string; storedAt: string;
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <Image size={22} color="#8b5cf6" />;
  if (mime.startsWith('video/')) return <FileVideo size={22} color="#ef4444" />;
  if (mime.startsWith('audio/')) return <Music size={22} color="#3b82f6" />;
  if (mime.includes('pdf')) return <FileText size={22} color="#ef4444" />;
  return <File size={22} color="#6366f1" />;
}

function fileExt(mime: string) {
  return (mime.split('/')[1] || 'file').toUpperCase().replace('JPEG','JPG').replace('PLAIN','TXT');
}

export function VaultScreen() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<VFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<VFile | null>(null);
  const [sharing, setSharing] = useState<VFile | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retrieving, setRetrieving] = useState('');

  function load() {
    setLoading(true);
    listVaultRecords()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((vs: any[]) => setFiles(vs.map((v) => ({
        id: v.id, name: v.originalFileName ?? 'file', mime: v.originalMimeType ?? '',
        size: v.originalSizeBytes || 0, encSize: v.encryptedSizeBytes || 0,
        dnaRecordId: v.dnaRecordId ?? '', encryption: v.encryptionAlgorithm ?? 'AES-256-GCM',
        keyDerivation: v.keyDerivation ?? 'HKDF-SHA256',
        storedAt: v.createdAt ? new Date(v.createdAt).toLocaleString() : '',
      }))))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function handleShare(f: VFile) {
    setSharing(f); setShareUrl(''); setShareLoading(true); setCopied(false);
    try {
      const token = localStorage.getItem('pinit_access_token');
      const { data } = await axios.post(`${API_BASE_URL}/share`, { vaultId: f.id, allowDownload: true }, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 60000,
      });
      setShareUrl((data as { shareUrl?: string }).shareUrl || '');
    } catch { setShareUrl('error'); }
    setShareLoading(false);
  }

  async function handleRetrieve(f: VFile) {
    setRetrieving(f.id);
    try {
      const blob = await retrieveFromVault(f.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Retrieve failed — try again.'); }
    setRetrieving('');
  }

  function copyUrl() {
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  const totalEnc = files.reduce((s, f) => s + f.encSize, 0);

  return (
    <>
      <AppHeader icon={<Archive size={22} color="#fff" />} title="Vault" tagline="Secure. Organize. Protect." />

      <div className="pa-stats" style={{ marginBottom: 6 }}>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(99,102,241,0.14)' }}><Lock size={17} color="var(--primary)" /></div><div className="pa-stat-n">{files.length}</div><div className="pa-stat-l">Encrypted</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><ShieldCheck size={17} color="#10b981" /></div><div className="pa-stat-n">{formatBytes(totalEnc)}</div><div className="pa-stat-l">Total Size</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(139,92,246,0.14)' }}><Archive size={17} color="#8b5cf6" /></div><div className="pa-stat-n">AES</div><div className="pa-stat-l">256-GCM</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(59,130,246,0.14)' }}><ShieldCheck size={17} color="#3b82f6" /></div><div className="pa-stat-n">100%</div><div className="pa-stat-l">Coverage</div></div>
      </div>

      <div className="pa-section">
        <h2>Vault Files</h2>
        <button className="pa-link" onClick={load} style={{ background: 'none', border: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={14} className={loading ? 'pa-spin' : ''} /> Refresh
        </button>
      </div>

      {files.length === 0 && !loading && (
        <div className="pa-card" style={{ padding: 32, textAlign: 'center' }}>
          <Archive size={40} color="var(--muted)" style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <div style={{ fontSize: 15, fontWeight: 700 }}>No vault records</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Encrypt and store files via Generate DNA</div>
          <button onClick={() => navigate('/generate')} style={{ marginTop: 16, padding: '12px 20px', borderRadius: 14, border: 0, fontWeight: 700, fontSize: 14, color: '#fff', background: 'linear-gradient(135deg, var(--primary), var(--primary-2))' }}>
            + Generate DNA
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {files.map((f) => (
          <div className="pa-card" key={f.id} style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(99,102,241,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {fileIcon(f.mime)}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, display: 'flex', gap: 8 }}>
                  <span>{fileExt(f.mime)}</span><span>·</span><span>{formatBytes(f.size)}</span><span>·</span>
                  <span style={{ color: '#10b981', fontWeight: 600 }}>Encrypted</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', marginBottom: 12 }}>
              <ShieldCheck size={15} color="#10b981" />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#059669' }}>{f.encryption} · {formatBytes(f.encSize)} encrypted</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <ActBtn icon={<Eye size={15} />} label="View" onClick={() => setDetail(f)} />
              <ActBtn icon={<Share2 size={15} />} label="Share" primary onClick={() => handleShare(f)} />
              <ActBtn icon={retrieving === f.id ? <Loader2 size={15} className="pa-spin" /> : <Download size={15} />} label="Retrieve" onClick={() => handleRetrieve(f)} />
              <ActBtn icon={<FileText size={15} />} label="Details" onClick={() => setDetail(f)} />
            </div>
          </div>
        ))}
      </div>

      {/* ── Detail modal ──────────────────────────────────────────────────── */}
      {detail && (
        <Modal title="Vault Record" onClose={() => setDetail(null)}>
          <Row label="File" value={detail.name} />
          <Row label="Type" value={fileExt(detail.mime)} />
          <Row label="Original Size" value={formatBytes(detail.size)} />
          <Row label="Encrypted Size" value={formatBytes(detail.encSize)} />
          <Row label="Encryption" value={detail.encryption} accent />
          <Row label="Key Derivation" value={detail.keyDerivation} />
          <Row label="Stored At" value={detail.storedAt} />
          <Row label="Vault ID" value={detail.id} mono />
          <Row label="DNA Record" value={detail.dnaRecordId} mono />
        </Modal>
      )}

      {/* ── Share modal ───────────────────────────────────────────────────── */}
      {sharing && (
        <Modal title="Share File" onClose={() => { setSharing(null); setShareUrl(''); }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(99,102,241,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fileIcon(sharing.mime)}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{sharing.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatBytes(sharing.size)} · {sharing.encryption}</div>
            </div>
          </div>
          {shareLoading && <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={24} className="pa-spin" color="var(--primary)" /></div>}
          {shareUrl === 'error' && <div style={{ color: '#ef4444', fontSize: 13, textAlign: 'center' }}>Failed to create share link. Try again.</div>}
          {shareUrl && shareUrl !== 'error' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', marginBottom: 12 }}>
                <CheckCircle2 size={16} color="#10b981" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#059669' }}>Smart Link Generated!</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Share URL</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <div style={{ flex: 1, fontSize: 12, color: 'var(--primary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shareUrl}</div>
                <button onClick={copyUrl} style={{ padding: '8px 14px', borderRadius: 10, border: 0, fontWeight: 700, fontSize: 12, color: '#fff', background: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {copied ? <><CheckCircle2 size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={`https://wa.me/?text=${encodeURIComponent(`📄 ${sharing.name}\n🔒 Protected by PINIT DNA (AES-256-GCM)\n\nAccess this secure file:\n${shareUrl}\n\nPowered by PINIT DNA — Human Origin Identity`)}`} target="_blank" rel="noreferrer" style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>WhatsApp</a>
                <a href={`mailto:?subject=${encodeURIComponent(`Secure File: ${sharing.name}`)}&body=${encodeURIComponent(`Hi,\n\nI'm sharing a secure file with you via PINIT DNA.\n\n📄 File: ${sharing.name}\n🔒 Encryption: AES-256-GCM\n\nAccess the file here:\n${shareUrl}\n\nAll access is tracked and logged.\n\n— Sent via PINIT DNA`)}`} style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>Email</a>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 12 }}>Access is tracked — every view logged with IP, browser, location</div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function ActBtn({ icon, label, primary, onClick }: { icon: React.ReactNode; label: string; primary?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 6px', borderRadius: 12, border: 0, fontSize: 11, fontWeight: 600, background: primary ? 'linear-gradient(135deg, var(--primary), var(--primary-2))' : 'var(--chip)', color: primary ? '#fff' : 'var(--text-2)' }}>
      {icon}{label}
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 460, maxHeight: '80vh', overflowY: 'auto', background: 'var(--card)', borderRadius: '22px 22px 0 0', padding: '20px 18px 32px', boxShadow: '0 -12px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{title}</span>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-2)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: accent ? '#10b981' : 'var(--text)', fontFamily: mono ? 'monospace' : 'inherit', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{value}</span>
    </div>
  );
}
