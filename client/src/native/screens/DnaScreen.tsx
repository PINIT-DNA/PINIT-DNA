import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dna, GitCompare, FileSearch, Microscope, ShieldCheck, FileText, Plus, RefreshCw, Search, Clock, Award, ChevronRight } from 'lucide-react';
import { AppHeader } from './parts';
import { listDnaRecords, deriveFileType } from '../../services/dashboard.api';

interface Rec { name: string; size: number; type: string; status: string; id: string; }

export function DnaScreen() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    listDnaRecords()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((rs: any[]) => setRecords(rs.map((r) => ({
        name: r.filename ?? r.imageFilename ?? 'file',
        size: r.imageSizeBytes ?? 0,
        type: deriveFileType(r),
        status: r.status ?? 'PARTIAL',
        id: r.id,
      }))))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const actions = [
    { t: 'Generate', icon: Plus, color: '#6366f1', bg: 'rgba(99,102,241,0.14)', to: '/generate' },
    { t: 'Compare', icon: GitCompare, color: '#3b82f6', bg: 'rgba(59,130,246,0.14)', to: '/compare' },
    { t: 'Difference', icon: Microscope, color: '#a78bfa', bg: 'rgba(167,139,250,0.16)', to: '/forensic-diff' },
    { t: 'AI Search', icon: Search, color: '#10b981', bg: 'rgba(16,185,129,0.14)', to: '/search' },
  ];

  const tools = [
    { t: 'All DNA Records', s: 'View all generated fingerprints', icon: FileSearch, to: '/dna-records' },
    { t: 'File Timeline', s: 'Complete lifecycle audit trail', icon: Clock, to: '/timeline' },
    { t: 'Certificates', s: 'Ownership and verification proofs', icon: Award, to: '/certificates' },
    { t: 'Verify Certificate', s: 'Check certificate authenticity', icon: ShieldCheck, to: '/verify-certificate' },
  ];

  return (
    <>
      <AppHeader icon={<Dna size={22} color="#fff" />} title="DNA Intelligence" tagline="Digital Identity. Verified." />

      <div className="pa-stats" style={{ marginBottom: 6 }}>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(99,102,241,0.14)' }}><Dna size={17} color="var(--primary)" /></div><div className="pa-stat-n">{records.length}</div><div className="pa-stat-l">Total</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><ShieldCheck size={17} color="#10b981" /></div><div className="pa-stat-n">{records.filter(r => r.status === 'COMPLETE').length}</div><div className="pa-stat-l">Complete</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(245,158,11,0.16)' }}><FileText size={17} color="#f59e0b" /></div><div className="pa-stat-n">{records.filter(r => r.status === 'PARTIAL').length}</div><div className="pa-stat-l">Partial</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(239,68,68,0.14)' }}><FileText size={17} color="#ef4444" /></div><div className="pa-stat-n">{records.filter(r => r.status === 'FAILED').length}</div><div className="pa-stat-l">Failed</div></div>
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

      <div className="pa-section"><h2>DNA Tools</h2></div>
      <div className="pa-card">
        {tools.map((t) => (
          <div className="pa-row" key={t.t} onClick={() => navigate(t.to)} style={{ cursor: 'pointer' }}>
            <div className="pa-row-ic" style={{ background: 'rgba(99,102,241,0.12)' }}><t.icon size={18} color="var(--primary)" /></div>
            <div style={{ minWidth: 0, flex: 1 }}><div className="pa-row-t">{t.t}</div><div className="pa-row-s">{t.s}</div></div>
            <ChevronRight size={16} color="var(--muted)" />
          </div>
        ))}
      </div>

      <div className="pa-section"><h2>Recent Records</h2>
        <button className="pa-link" onClick={load} style={{ background: 'none', border: 0 }}><RefreshCw size={14} className={loading ? 'pa-spin' : ''} /> Refresh</button>
      </div>
      <div className="pa-card">
        {records.length === 0 && !loading && (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Dna size={36} color="var(--muted)" style={{ margin: '0 auto 10px', opacity: 0.5 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>No DNA records</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Generate a fingerprint to see records here</div>
            <button onClick={() => navigate('/generate')} style={{ marginTop: 14, padding: '10px 18px', borderRadius: 12, border: 0, fontWeight: 700, fontSize: 13, color: '#fff', background: 'linear-gradient(135deg, var(--primary), var(--primary-2))' }}>
              <Plus size={14} style={{ verticalAlign: -2 }} /> Generate DNA
            </button>
          </div>
        )}
        {records.map((r) => (
          <div className="pa-row" key={r.id} onClick={() => navigate('/dna-records')}>
            <div className="pa-row-ic" style={{ background: 'rgba(99,102,241,0.12)' }}><FileText size={18} color="var(--primary)" /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="pa-row-t" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{r.name}</div>
              <div className="pa-row-s">{r.type} · {(r.size / 1024).toFixed(1)} KB</div>
            </div>
            <span className={`pa-pill ${r.status === 'COMPLETE' ? 'green' : r.status === 'FAILED' ? 'red' : 'amber'}`}>
              {r.status === 'COMPLETE' ? 'Complete' : r.status === 'FAILED' ? 'Failed' : 'Partial'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
