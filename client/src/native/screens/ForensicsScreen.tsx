import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert, ShieldCheck, FileText, EyeOff, Copy, Activity, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { AppHeader } from './parts';

export function ForensicsScreen() {
  const navigate = useNavigate();

  const stats = [
    { n: 3, l: 'High Risk', icon: AlertTriangle, c: '#ef4444' },
    { n: 2, l: 'Unmask Requests', icon: EyeOff, c: '#f59e0b' },
    { n: 5, l: 'Reports', icon: FileText, c: '#60a5fa' },
    { n: '98%', l: 'Vault Integrity', icon: ShieldCheck, c: '#10b981' },
  ];

  const tools = [
    { t: 'Security Center', s: 'Monitor threats & anomalies in real-time.', icon: ShieldCheck, pill: '3 Alerts', cls: 'red', to: '/security-center' },
    { t: 'Forensic Reports', s: 'View and export analysis reports.', icon: FileText, pill: '5 New', cls: 'blue', to: '/reports' },
    { t: 'Unmask Requests', s: 'Review requests to unmask identities.', icon: EyeOff, pill: '2 Pending', cls: 'amber', to: '/unmask-requests' },
    { t: 'Duplicate Attempts', s: 'Detect duplicate or reused files.', icon: Copy, pill: '3 Detected', cls: 'red', to: '/duplicate-attempts' },
    { t: 'Vault Integrity', s: 'Check vault health & tamper logs.', icon: Activity, pill: 'Healthy', cls: 'green', to: '/vault-integrity' },
  ];

  const activity = [
    { t: 'Duplicate attempt detected', s: 'suspicious_file.pdf', time: '2m ago', pill: 'High Risk', cls: 'red', dot: '#ef4444' },
    { t: 'Unmask request submitted', s: 'user_8921 requested access', time: '15m ago', pill: 'Pending', cls: 'amber', dot: '#f59e0b' },
    { t: 'Forensic report generated', s: 'report_2024_05_20.pdf', time: '1h ago', pill: 'New', cls: 'blue', dot: '#60a5fa' },
  ];

  return (
    <>
      <AppHeader icon={<ShieldAlert size={22} color="#fff" />} title="Forensics" tagline="Detect. Analyze. Protect." />

      {/* Threat overview */}
      <div className="pa-hero" onClick={() => navigate('/forensic-dashboard')}>
        <ShieldCheck className="pa-hero-helix" size={170} color="#a78bfa" strokeWidth={1} />
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.8 }}>Forensic Overview</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8, opacity: 0.9 }}>Threat Score</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
          <span className="pa-hero-big" style={{ fontSize: 46 }}>98<span style={{ fontSize: 22 }}>%</span></span>
          <span className="pa-pill red" style={{ marginBottom: 8 }}>Critical</span>
        </div>
        <div className="pa-hero-badge" style={{ color: '#fecaca' }}><AlertTriangle size={14} /> 3 risks need attention</div>
      </div>

      {/* Stats */}
      <div className="pa-stats" style={{ marginTop: 16 }}>
        {stats.map((s) => (
          <div className="pa-stat" key={s.l}>
            <div className="pa-stat-ic" style={{ background: s.c + '22' }}><s.icon size={16} color={s.c} /></div>
            <div className="pa-stat-n">{s.n}</div><div className="pa-stat-l">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Forensic Tools */}
      <div className="pa-section"><h2>Forensic Tools</h2><span className="pa-link" onClick={() => navigate('/security-center')}>View All</span></div>
      <div className="pa-card">
        {tools.map((t) => (
          <div className="pa-row" key={t.t} onClick={() => navigate(t.to)}>
            <div className="pa-row-ic" style={{ background: 'rgba(124,108,240,0.16)' }}><t.icon size={18} color="#8b80f8" /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="pa-row-t">{t.t}</div>
              <div className="pa-row-s">{t.s}</div>
            </div>
            <span className={`pa-pill ${t.cls}`}>{t.pill}</span>
            <ChevronRight size={16} color="var(--muted)" />
          </div>
        ))}
      </div>

      {/* Recent Forensic Activity */}
      <div className="pa-section"><h2>Recent Forensic Activity</h2><span className="pa-link" onClick={() => navigate('/timeline')}>View Timeline</span></div>
      <div className="pa-card">
        {activity.map((a) => (
          <div className="pa-row" key={a.t}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: a.dot, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="pa-row-t">{a.t}</div>
              <div className="pa-row-s">{a.s}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="pa-time">{a.time}</div>
              <span className={`pa-pill ${a.cls}`} style={{ marginTop: 4 }}>{a.pill}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
