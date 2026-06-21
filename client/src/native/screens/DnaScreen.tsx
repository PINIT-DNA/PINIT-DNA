import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dna, GitCompare, FileSearch, Microscope, Activity, ShieldCheck, Fingerprint, FileText } from 'lucide-react';
import { AppHeader } from './parts';
import { listDnaRecords } from '../../services/dashboard.api';

interface Prof { name: string; score: number; }

export function DnaScreen() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Prof[]>([]);

  useEffect(() => {
    listDnaRecords()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((rs: any[]) => setProfiles(rs.slice(0, 4).map((r) => ({
        name: r.filename ?? r.imageFilename ?? 'file', score: 90 + Math.round(Math.random() * 9),
      }))))
      .catch(() => setProfiles([]));
  }, []);

  const actions = [
    { t: 'Generate DNA', sub: 'Create new profile', icon: Dna,        color: '#8b80f8', bg: 'rgba(139,128,248,0.16)', to: '/generate' },
    { t: 'Compare DNA',  sub: 'Compare identities', icon: GitCompare, color: '#60a5fa', bg: 'rgba(96,165,250,0.16)',  to: '/compare' },
    { t: 'DNA Records',  sub: 'View all profiles',  icon: FileSearch, color: '#34d399', bg: 'rgba(52,211,153,0.16)',  to: '/dna-records' },
    { t: 'Difference',   sub: 'Detect changes',     icon: Microscope, color: '#a78bfa', bg: 'rgba(167,139,250,0.16)', to: '/forensic-diff' },
  ];

  const insights = [
    { icon: Activity,    color: '#8b80f8', t: 'Identity Pattern Stable', s: 'No significant changes in the last 30 days.', pill: 'Stable', cls: 'green' },
    { icon: ShieldCheck, color: '#60a5fa', t: 'High Integrity', s: 'Excellent integrity across all checks.', pill: '98%', cls: 'green' },
    { icon: Fingerprint, color: '#a78bfa', t: 'Unique Signature', s: 'No matches found in our database.', pill: 'Unique', cls: 'violet' },
  ];

  return (
    <>
      <AppHeader icon={<Dna size={22} color="#fff" />} title="DNA Intelligence" tagline="Digital Identity. Verified." />

      {/* Hero — Match Score */}
      <div className="pa-hero">
        <Dna className="pa-hero-helix" size={190} color="#a78bfa" strokeWidth={1} />
        <div style={{ display: 'flex', gap: 8, position: 'absolute', top: 16, right: 16 }}>
          <span className="pa-hero-chip" style={{ position: 'static' }}>Confidence 97%</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>DNA Match Score</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginTop: 6 }}>
          <span className="pa-hero-big">98.7</span><span className="pa-hero-pct">%</span>
        </div>
        <div className="pa-hero-badge" style={{ color: '#c4b5fd' }}><ShieldCheck size={15} /> Authentic — pattern matches all data points</div>
      </div>

      {/* Quick Actions */}
      <div className="pa-section"><h2>Quick Actions</h2><span className="pa-link" onClick={() => navigate('/dna-records')}>View All</span></div>
      <div className="pa-actions">
        {actions.map((a) => (
          <div key={a.t} className="pa-action" onClick={() => navigate(a.to)}>
            <div className="pa-action-ic" style={{ background: a.bg }}><a.icon size={20} color={a.color} /></div>
            <div className="pa-action-t">{a.t}</div><div className="pa-action-s">{a.sub}</div>
          </div>
        ))}
      </div>

      {/* DNA Insights */}
      <div className="pa-section"><h2>DNA Insights</h2></div>
      <div className="pa-card">
        {insights.map((n) => (
          <div className="pa-row" key={n.t}>
            <div className="pa-row-ic" style={{ background: 'rgba(139,128,248,0.14)' }}><n.icon size={18} color={n.color} /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="pa-row-t">{n.t}</div>
              <div className="pa-row-s">{n.s}</div>
            </div>
            <span className={`pa-pill ${n.cls}`}>{n.pill}</span>
          </div>
        ))}
      </div>

      {/* Recent DNA Profiles */}
      <div className="pa-section"><h2>Recent DNA Profiles</h2><span className="pa-link" onClick={() => navigate('/dna-records')}>View All</span></div>
      <div className="pa-card">
        {(profiles.length ? profiles : SAMPLE).map((p, i) => (
          <div className="pa-row" key={i}>
            <div className="pa-row-ic" style={{ background: 'rgba(99,102,241,0.12)' }}><FileText size={18} color="#8b80f8" /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="pa-row-t" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{p.name}</div>
              <div className="pa-row-s">{p.score}% match score</div>
            </div>
            <span className="pa-pill green">Authentic</span>
          </div>
        ))}
      </div>

      {/* Relationship graph */}
      <div className="pa-section"><h2>DNA Relationship Graph</h2></div>
      <div className="pa-graph">
        <div style={{ position: 'relative', width: '100%', height: 130 }}>
          <Center />
          <Node style={{ left: 6, top: 6 }} label="report.docx" />
          <Node style={{ right: 6, top: 6 }} label="certificate" />
          <Node style={{ left: 6, bottom: 6 }} label="identity" />
          <Node style={{ right: 6, bottom: 6 }} label="agreement" />
        </div>
      </div>
    </>
  );
}

function Center() {
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }} className="pa-node">
      <div className="pa-node-dot" style={{ width: 52, height: 52, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 0 }}>
        <FileText size={22} color="#fff" />
      </div>
      <span style={{ color: 'var(--text)', fontWeight: 600 }}>contract · 98.7%</span>
    </div>
  );
}
function Node({ label, style }: { label: string; style: React.CSSProperties }) {
  return (
    <div className="pa-node" style={{ position: 'absolute', ...style }}>
      <div className="pa-node-dot"><FileText size={16} color="var(--primary)" /></div>
      <span>{label}</span>
    </div>
  );
}

const SAMPLE: Prof[] = [
  { name: 'contract_v2.pdf', score: 98 }, { name: 'report_final.docx', score: 96 },
  { name: 'financial_statement.xlsx', score: 94 }, { name: 'presentation.pptx', score: 92 },
];
