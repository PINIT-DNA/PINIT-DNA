import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive, ShieldCheck, FileText, RefreshCw, Lock, Eye, Share2, Download,
  Image, FileVideo, Music, File, ChevronRight,
} from 'lucide-react';
import { AppHeader } from './parts';
import { listVaultRecords } from '../../services/dashboard.api';
import { formatBytes } from '../../hooks/useApi';

interface VFile {
  id: string; name: string; mime: string; size: number; encSize: number;
  dnaRecordId: string;
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <Image size={22} color="#8b5cf6" />;
  if (mime.startsWith('video/')) return <FileVideo size={22} color="#ef4444" />;
  if (mime.startsWith('audio/')) return <Music size={22} color="#3b82f6" />;
  if (mime.includes('pdf')) return <FileText size={22} color="#ef4444" />;
  return <File size={22} color="#6366f1" />;
}

function fileExt(mime: string) {
  const ext = mime.split('/')[1] || 'file';
  return ext.toUpperCase().replace('JPEG','JPG').replace('PLAIN','TXT');
}

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
        dnaRecordId: v.dnaRecordId ?? '',
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
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(99,102,241,0.14)' }}><Lock size={17} color="var(--primary)" /></div><div className="pa-stat-n">{files.length}</div><div className="pa-stat-l">Encrypted</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><ShieldCheck size={17} color="#10b981" /></div><div className="pa-stat-n">{formatBytes(totalEnc)}</div><div className="pa-stat-l">Total Size</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(139,92,246,0.14)' }}><Archive size={17} color="#8b5cf6" /></div><div className="pa-stat-n">AES</div><div className="pa-stat-l">256-GCM</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(59,130,246,0.14)' }}><ShieldCheck size={17} color="#3b82f6" /></div><div className="pa-stat-n">100%</div><div className="pa-stat-l">Coverage</div></div>
      </div>

      {/* Files */}
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

      {/* File cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {files.map((f) => (
          <div className="pa-card" key={f.id} style={{ padding: 16 }}>
            {/* File info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(99,102,241,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {fileIcon(f.mime)}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>{fileExt(f.mime)}</span>
                  <span>·</span>
                  <span>{formatBytes(f.size)}</span>
                  <span>·</span>
                  <span style={{ color: '#10b981', fontWeight: 600 }}>Encrypted</span>
                </div>
              </div>
            </div>

            {/* Encryption badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', marginBottom: 12 }}>
              <ShieldCheck size={15} color="#10b981" />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#059669' }}>AES-256-GCM · {formatBytes(f.encSize)} encrypted</span>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <ActionBtn icon={<Eye size={15} />} label="View" onClick={() => navigate('/vault')} />
              <ActionBtn icon={<Share2 size={15} />} label="Share" primary onClick={() => navigate('/vault')} />
              <ActionBtn icon={<Download size={15} />} label="Retrieve" onClick={() => navigate('/vault')} />
              <ActionBtn icon={<ChevronRight size={15} />} label="Details" onClick={() => navigate('/vault')} />
            </div>
          </div>
        ))}
      </div>

      {/* Open full explorer */}
      {files.length > 0 && (
        <button
          onClick={() => navigate('/vault')}
          style={{ width: '100%', marginTop: 16, padding: '14px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--primary)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Archive size={16} /> Open Full Vault Explorer
        </button>
      )}
    </>
  );
}

function ActionBtn({ icon, label, primary, onClick }: { icon: React.ReactNode; label: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: '10px 6px', borderRadius: 12, border: 0, fontSize: 11, fontWeight: 600,
        background: primary ? 'linear-gradient(135deg, var(--primary), var(--primary-2))' : 'var(--chip)',
        color: primary ? '#fff' : 'var(--text-2)',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
