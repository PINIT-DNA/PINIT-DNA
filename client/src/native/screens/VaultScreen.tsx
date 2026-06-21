import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive, Search, Image, Video, Music, FileText, Code, Brain, Box, Database,
  FileArchive, HelpCircle, ShieldCheck, Radio,
} from 'lucide-react';
import { AppHeader } from './parts';
import { listVaultRecords } from '../../services/dashboard.api';
import { formatBytes } from '../../hooks/useApi';

export function VaultScreen() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<Array<{ name: string; size: number }>>([]);
  const [bytes, setBytes] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    listVaultRecords()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((vs: any[]) => {
        setCount(vs.length);
        setBytes(vs.reduce((s, v) => s + (v.encryptedSizeBytes || 0), 0));
        setFiles(vs.slice(0, 5).map((v) => ({ name: v.originalFileName ?? 'file', size: v.encryptedSizeBytes || 0 })));
      })
      .catch(() => {});
  }, []);

  const assets = [
    { l: 'Visual Media', n: 520, icon: Image, c: '#8b80f8' }, { l: 'Video', n: 213, icon: Video, c: '#ef4444' },
    { l: 'Audio', n: 248, icon: Music, c: '#10b981' }, { l: 'Documents', n: 198, icon: FileText, c: '#60a5fa' },
    { l: 'Source Code', n: 156, icon: Code, c: '#f59e0b' }, { l: 'AI-Generated', n: 86, icon: Brain, c: '#a78bfa' },
    { l: '3D/Spatial', n: 34, icon: Box, c: '#06b6d4' }, { l: 'Datasets', n: 71, icon: Database, c: '#f97316' },
    { l: 'Composite', n: 64, icon: FileArchive, c: '#10b981' }, { l: 'Future', n: 12, icon: HelpCircle, c: '#9499b3' },
  ];

  return (
    <>
      <AppHeader icon={<Archive size={22} color="#fff" />} title="Vault" tagline="Secure. Organize. Protect." />

      {/* Overview */}
      <div className="pa-hero" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Archive className="pa-hero-helix" size={170} color="#a78bfa" strokeWidth={1} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>Used Storage</div>
          <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1 }}>{bytes ? formatBytes(bytes) : '0 B'}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
            <Mini n={count || 0} l="Files" />
            <Mini n="98%" l="Protected" />
            <Mini n="12" l="Types" />
          </div>
        </div>
        <div className="pa-ring" style={{ ['--p' as string]: '64%' }}><span>64%</span></div>
      </div>

      {/* Search */}
      <div
        onClick={() => navigate('/vault')}
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '13px 14px', borderRadius: 14, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 13 }}
      >
        <Search size={16} /> Search files, assets, or metadata…
      </div>

      {/* Asset Types */}
      <div className="pa-section"><h2>Asset Types</h2><span className="pa-link" onClick={() => navigate('/vault')}>View All</span></div>
      <div className="pa-asset-grid">
        {assets.map((a) => (
          <div className="pa-asset" key={a.l} onClick={() => navigate('/vault')}>
            <div className="pa-asset-ic" style={{ background: a.c + '22' }}><a.icon size={17} color={a.c} /></div>
            <div className="pa-asset-l">{a.l}</div>
            <div className="pa-asset-n">{a.n}</div>
          </div>
        ))}
      </div>

      {/* Recent Files */}
      <div className="pa-section"><h2>Recent Files</h2><span className="pa-link" onClick={() => navigate('/vault')}>View All</span></div>
      <div className="pa-card">
        {(files.length ? files : SAMPLE).map((f, i) => (
          <div className="pa-row" key={i}>
            <div className="pa-row-ic" style={{ background: 'rgba(99,102,241,0.12)' }}><FileText size={18} color="#8b80f8" /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="pa-row-t" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}>{f.name}</div>
              <div className="pa-row-s">{formatBytes(f.size)}</div>
            </div>
            <span className="pa-pill green"><ShieldCheck size={11} style={{ verticalAlign: -1 }} /> Protected</span>
          </div>
        ))}
      </div>

      {/* Monitoring */}
      <div className="pa-card" style={{ marginTop: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }} onClick={() => navigate('/monitoring')}>
        <div className="pa-row-ic" style={{ background: 'rgba(124,108,240,0.16)' }}><Radio size={18} color="#8b80f8" /></div>
        <div style={{ flex: 1 }}>
          <div className="pa-row-t">Monitoring & Crawler</div>
          <div className="pa-row-s">Watching for unauthorized copies</div>
        </div>
        <span className="pa-pill green">Active</span>
      </div>
    </>
  );
}

function Mini({ n, l }: { n: React.ReactNode; l: string }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{n}</div>
      <div style={{ fontSize: 10.5, opacity: 0.85 }}>{l}</div>
    </div>
  );
}

const SAMPLE = [
  { name: 'Research_Paper.pdf', size: 2_400_000 }, { name: 'project_diagram.png', size: 1_800_000 },
  { name: 'product_demo.mp4', size: 24_600_000 }, { name: 'config_system.json', size: 8_700 },
];
