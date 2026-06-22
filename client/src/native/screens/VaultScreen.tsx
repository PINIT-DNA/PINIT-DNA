import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ShieldCheck, FileText, Plus, RefreshCw, Eye, Share2, Lock } from 'lucide-react';
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

  return (
    <>
      <AppHeader icon={<Archive size={22} color="#fff" />} title="Vault" tagline="Secure. Organize. Protect." />

      {/* Stats */}
      <div className="pa-stats" style={{ marginBottom: 6 }}>
        <div className="pa-stat">
          <div className="pa-stat-ic" style={{ background: 'rgba(99,102,241,0.14)' }}><Lock size={17} color="var(--primary)" /></div>
          <div className="pa-stat-n">{files.length}</div><div className="pa-stat-l">Encrypted</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><ShieldCheck size={17} color="#10b981" /></div>
          <div className="pa-stat-n">{formatBytes(totalEnc)}</div><div className="pa-stat-l">Total Size</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-ic" style={{ background: 'rgba(139,92,246,0.14)' }}><Archive size={17} color="#8b5cf6" /></div>
          <div className="pa-stat-n">AES</div><div className="pa-stat-l">256-GCM</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-ic" style={{ background: 'rgba(59,130,246,0.14)' }}><ShieldCheck size={17} color="#3b82f6" /></div>
          <div className="pa-stat-n">100%</div><div className="pa-stat-l">Coverage</div>
        </div>
      </div>

      {/* Actions */}
      <div className="pa-section"><h2>Actions</h2></div>
      <div className="pa-actions">
        <div className="pa-action" onClick={() => navigate('/generate')}><div className="pa-action-ic" style={{ background: 'rgba(99,102,241,0.14)' }}><Plus size={20} color="var(--primary)" /></div><div className="pa-action-t">Upload</div></div>
        <div className="pa-action" onClick={() => navigate('/vault')}><div className="pa-action-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><Eye size={20} color="#10b981" /></div><div className="pa-action-t">Explorer</div></div>
        <div className="pa-action" onClick={() => navigate('/vault-integrity')}><div className="pa-action-ic" style={{ background: 'rgba(245,158,11,0.16)' }}><ShieldCheck size={20} color="#f59e0b" /></div><div className="pa-action-t">Integrity</div></div>
        <div className="pa-action" onClick={() => navigate('/vault')}><div className="pa-action-ic" style={{ background: 'rgba(59,130,246,0.14)' }}><Share2 size={20} color="#3b82f6" /></div><div className="pa-action-t">Share</div></div>
      </div>

      {/* Files */}
      <div className="pa-section">
        <h2>Vault Files</h2>
        <button className="pa-link" onClick={load} style={{ background: 'none', border: 0 }}>
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
      </div>
    </>
  );
}
