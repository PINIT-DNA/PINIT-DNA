import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ShieldCheck, FileText, Plus, RefreshCw, Eye, Share2, Lock, Activity } from 'lucide-react';
import { AppHeader } from './parts';
import { listVaultRecords } from '../../services/dashboard.api';
import { formatBytes } from '../../hooks/useApi';

interface VFile { id: string; name: string; mime: string; size: number; encSize: number; }

export function VaultScreen() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<VFile[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    listVaultRecords()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((vs: any[]) => setFiles(vs.map((v) => ({
        id: v.id, name: v.originalFileName ?? 'file', mime: v.originalMimeType ?? '',
        size: v.originalSizeBytes || 0, encSize: v.encryptedSizeBytes || 0,
      }))))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const totalEnc = files.reduce((s, f) => s + f.encSize, 0);

  const actions = [
    { t: 'Upload', icon: Plus, color: '#6366f1', bg: 'rgba(99,102,241,0.14)', to: '/generate' },
    { t: 'Explorer', icon: Eye, color: '#10b981', bg: 'rgba(16,185,129,0.14)', to: '/vault' },
    { t: 'Integrity', icon: Activity, color: '#f59e0b', bg: 'rgba(245,158,11,0.16)', to: '/vault-integrity' },
    { t: 'Share', icon: Share2, color: '#3b82f6', bg: 'rgba(59,130,246,0.14)', to: '/vault' },
  ];

  return (
    <>
      <AppHeader icon={<Archive size={22} color="#fff" />} title="Vault" tagline="Secure. Organize. Protect." />

      <div className="pa-stats" style={{ marginBottom: 6 }}>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(99,102,241,0.14)' }}><Lock size={17} color="var(--primary)" /></div><div className="pa-stat-n">{files.length}</div><div className="pa-stat-l">Encrypted</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><ShieldCheck size={17} color="#10b981" /></div><div className="pa-stat-n">{formatBytes(totalEnc)}</div><div className="pa-stat-l">Total Size</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(139,92,246,0.14)' }}><Archive size={17} color="#8b5cf6" /></div><div className="pa-stat-n">AES</div><div className="pa-stat-l">256-GCM</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(59,130,246,0.14)' }}><ShieldCheck size={17} color="#3b82f6" /></div><div className="pa-stat-n">100%</div><div className="pa-stat-l">Coverage</div></div>
      </div>

      <div className="pa-section"><h2>Quick Actions</h2></div>
      <div className="pa-actions">
        {actions.map((a) => (
          <div key={a.t} className="pa-action" onClick={() => navigate(a.to)}>
            <div className="pa-action-ic" style={{ background: a.bg }}><a.icon size={20} color={a.color} /></div>
            <div className="pa-action-t">{a.t}</div>
          </div>
        ))}
      </div>

      <div className="pa-section">
        <h2>Vault Files</h2>
        <button className="pa-link" onClick={load} style={{ background: 'none', border: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={14} className={loading ? 'pa-spin' : ''} /> Refresh
        </button>
      </div>
      <div className="pa-card">
        {files.length === 0 && !loading && (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Archive size={36} color="var(--muted)" style={{ margin: '0 auto 10px', opacity: 0.5 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>No vault records</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Encrypt and store files via Generate DNA</div>
            <button onClick={() => navigate('/generate')} style={{ marginTop: 14, padding: '10px 18px', borderRadius: 12, border: 0, fontWeight: 700, fontSize: 13, color: '#fff', background: 'linear-gradient(135deg, var(--primary), var(--primary-2))' }}>
              <Plus size={14} style={{ verticalAlign: -2 }} /> Upload File
            </button>
          </div>
        )}
        {files.map((f) => (
          <div className="pa-row" key={f.id} onClick={() => navigate('/vault')}>
            <div className="pa-row-ic" style={{ background: 'rgba(99,102,241,0.12)' }}><FileText size={18} color="var(--primary)" /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="pa-row-t" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 155 }}>{f.name}</div>
              <div className="pa-row-s">{f.mime.split('/')[1] || 'file'} · {formatBytes(f.size)}</div>
            </div>
            <span className="pa-pill green"><ShieldCheck size={11} style={{ verticalAlign: -1 }} /> Protected</span>
          </div>
        ))}
        {files.length > 0 && (
          <div style={{ padding: '10px 16px', textAlign: 'center' }}>
            <button className="pa-link" onClick={() => navigate('/vault')} style={{ background: 'none', border: 0 }}>
              <Eye size={14} style={{ verticalAlign: -2 }} /> Open Vault Explorer →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
