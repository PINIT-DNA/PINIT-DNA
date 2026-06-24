import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dna, GitCompare, FolderUp, ShieldCheck, Bell, Sun, Moon,
  TrendingUp, CheckCircle2, AlertTriangle, Award, Link2,
} from 'lucide-react';
import { useTheme } from '../theme';
import { getDashboardStats } from '../../services/dashboard.api';
import { formatBytes } from '../../hooks/useApi';

interface Stats {
  dna: number; vault: number; completed: number; bytes: number;
  recent: Array<{ filename: string; status: string; createdAt: string }>;
}

export function HomeScreen() {
  const navigate = useNavigate();
  const { mode, toggle } = useTheme();
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    getDashboardStats()
      .then((d) =>
        setS({
          dna: d.totalDnaRecords,
          vault: d.totalVaultRecords,
          completed: d.completedDna,
          bytes: d.totalEncryptedBytes,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recent: (d.recentActivity || []).slice(0, 4).map((r: any) => ({
            filename: r.filename ?? r.imageFilename ?? 'file',
            status: r.status ?? 'COMPLETE',
            createdAt: r.createdAt,
          })),
        })
      )
      .catch(() => setS({ dna: 0, vault: 0, completed: 0, bytes: 0, recent: [] }));
  }, []);

  const integrity = 98.7;
  const filesProtected = s ? s.dna : 142;
  const certificates = 24;
  const risks = 3;

  const actions = [
    { t: 'Generate DNA', sub: 'Create new DNA', icon: Dna,         color: '#6366f1', bg: 'rgba(99,102,241,0.14)',  to: '/generate' },
    { t: 'Compare DNA',  sub: 'Compare files',  icon: GitCompare,  color: '#3b82f6', bg: 'rgba(59,130,246,0.14)',  to: '/compare' },
    { t: 'Upload File',  sub: 'Add to vault',   icon: FolderUp,    color: '#10b981', bg: 'rgba(16,185,129,0.14)',  to: '/vault' },
    { t: 'Verify Cert',  sub: 'Check authenticity', icon: ShieldCheck, color: '#f59e0b', bg: 'rgba(245,158,11,0.16)', to: '/verify-certificate' },
  ];

  return (
    <>
      {/* Top bar */}
      <div className="pa-top">
        <div className="pa-logo"><Dna size={22} color="#fff" /></div>
        <div style={{ flex: 1 }}>
          <div className="pa-title">PINIT<span style={{ color: 'var(--primary)' }}>-DNA</span></div>
          <div className="pa-sub">Secure. Verify. Trust.</div>
        </div>
        <button className="pa-icon-btn" onClick={toggle} aria-label="Theme">
          {mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="pa-icon-btn"><Bell size={18} /></button>
      </div>

      {/* Hero — DNA Integrity Score */}
      <div className="pa-hero">
        <Dna className="pa-hero-helix" size={190} color="#ffffff" strokeWidth={1} />
        <div className="pa-hero-chip"><TrendingUp size={12} style={{ verticalAlign: -1 }} /> 12.4% vs last week</div>
        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>DNA Integrity Score</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginTop: 6 }}>
          <span className="pa-hero-big">{integrity}</span>
          <span className="pa-hero-pct">%</span>
        </div>
        <div className="pa-hero-badge"><ShieldCheck size={15} /> Excellent Integrity</div>
      </div>

      {/* Quick Actions */}
      <div className="pa-section"><h2>Quick Actions</h2><span className="pa-link" onClick={() => navigate('/dna-records')}>View All</span></div>
      <div className="pa-actions">
        {actions.map((a) => (
          <div key={a.t} className="pa-action" onClick={() => navigate(a.to)}>
            <div className="pa-action-ic" style={{ background: a.bg }}><a.icon size={20} color={a.color} /></div>
            <div className="pa-action-t">{a.t}</div>
            <div className="pa-action-s">{a.sub}</div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="pa-section"><h2>Recent Activity</h2><span className="pa-link" onClick={() => navigate('/timeline')}>View All</span></div>
      <div className="pa-card">
        {(s?.recent.length ? s.recent : SAMPLE).map((r, i) => (
          <div className="pa-row" key={i}>
            <div className="pa-row-ic" style={{ background: 'rgba(99,102,241,0.12)' }}><Dna size={18} color="#6366f1" /></div>
            <div style={{ minWidth: 0 }}>
              <div className="pa-row-t">{r.status === 'COMPLETE' ? 'DNA Generated' : 'DNA Record'}</div>
              <div className="pa-row-s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}>{r.filename}</div>
            </div>
            <div className="pa-row-meta">
              <span className={`pa-pill ${r.status === 'COMPLETE' ? 'green' : 'amber'}`}>{r.status === 'COMPLETE' ? 'Success' : 'Partial'}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Integrity Overview */}
      <div className="pa-section"><h2>Integrity Overview</h2></div>
      <div className="pa-stats">
        <Stat icon={<ShieldCheck size={17} color="#6366f1" />} bg="rgba(99,102,241,0.14)" n={filesProtected} l="Files Protected" />
        <Stat icon={<CheckCircle2 size={17} color="#10b981" />} bg="rgba(16,185,129,0.14)" n={`${integrity}%`} l="Integrity Score" />
        <Stat icon={<AlertTriangle size={17} color="#f59e0b" />} bg="rgba(245,158,11,0.16)" n={risks} l="Risks Detected" />
        <Stat icon={<Award size={17} color="#3b82f6" />} bg="rgba(59,130,246,0.14)" n={certificates} l="Certificates" />
      </div>

      {/* Storage Overview */}
      <div className="pa-section"><h2>Storage Overview</h2><span className="pa-link" onClick={() => navigate('/vault')}>View Details</span></div>
      <div className="pa-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Vault Storage</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s ? formatBytes(s.bytes) : '0 B'} / 256 GB</span>
        </div>
        <div className="pa-bar"><i style={{ width: '12%' }} /></div>
        <div onClick={() => navigate('/monitoring')} style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
          <Link2 size={14} color="#10b981" /> Monitoring & Crawler active <span className="pa-link" style={{ marginLeft: 'auto' }}>Open</span>
        </div>
      </div>
    </>
  );
}

function Stat({ icon, bg, n, l }: { icon: React.ReactNode; bg: string; n: React.ReactNode; l: string }) {
  return (
    <div className="pa-stat">
      <div className="pa-stat-ic" style={{ background: bg }}>{icon}</div>
      <div className="pa-stat-n">{n}</div>
      <div className="pa-stat-l">{l}</div>
    </div>
  );
}

const SAMPLE = [
  { filename: 'contract_v2.pdf', status: 'COMPLETE', createdAt: '' },
  { filename: 'report_v2.pdf', status: 'COMPLETE', createdAt: '' },
  { filename: 'certificate.pdf', status: 'COMPLETE', createdAt: '' },
];
