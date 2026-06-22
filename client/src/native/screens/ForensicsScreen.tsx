import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert, ShieldCheck, FileText, EyeOff, Copy, Activity, AlertTriangle, ChevronRight,
  Radio, LayoutDashboard, Search, Eye, Clock, Award,
} from 'lucide-react';
import { AppHeader } from './parts';

export function ForensicsScreen() {
  const navigate = useNavigate();

  const stats = [
    { n: 3, l: 'High Risk', icon: AlertTriangle, c: '#ef4444' },
    { n: 2, l: 'Unmask', icon: EyeOff, c: '#f59e0b' },
    { n: 5, l: 'Reports', icon: FileText, c: '#60a5fa' },
    { n: '98%', l: 'Integrity', icon: ShieldCheck, c: '#10b981' },
  ];

  const tools = [
    { t: 'Forensic Dashboard', s: 'Full forensic overview & analytics', icon: LayoutDashboard, pill: 'Open', cls: 'violet', to: '/forensic-dashboard' },
    { t: 'Monitoring & Crawler', s: 'Watch for unauthorized copies', icon: Radio, pill: 'Active', cls: 'green', to: '/monitoring' },
    { t: 'Security Center', s: 'Monitor threats in real-time', icon: ShieldCheck, pill: '3 Alerts', cls: 'red', to: '/security-center' },
    { t: 'Forensic Reports', s: 'View and export analysis reports', icon: FileText, pill: '5 New', cls: 'blue', to: '/reports' },
    { t: 'Unmask Requests', s: 'Review identity unmask requests', icon: EyeOff, pill: '2 Pending', cls: 'amber', to: '/unmask-requests' },
    { t: 'Duplicate Attempts', s: 'Detect duplicate or reused files', icon: Copy, pill: '3 Detected', cls: 'red', to: '/duplicate-attempts' },
    { t: 'Vault Integrity', s: 'Check vault health & tamper logs', icon: Activity, pill: 'Healthy', cls: 'green', to: '/vault-integrity' },
    { t: 'Verify Leaked File', s: 'Upload to identify original owner', icon: Search, pill: 'Open', cls: 'violet', to: '/verify-leaked' },
    { t: 'Access Intelligence', s: 'Per-link analytics & revoke', icon: Eye, pill: 'Open', cls: 'blue', to: '/access-intelligence' },
    { t: 'File Timeline', s: 'Complete lifecycle audit trail', icon: Clock, pill: 'Open', cls: 'violet', to: '/timeline' },
    { t: 'Certificates', s: 'Ownership and verification proofs', icon: Award, pill: 'Open', cls: 'green', to: '/certificates' },
    { t: 'Verify Certificate', s: 'Check certificate authenticity', icon: ShieldCheck, pill: 'Open', cls: 'violet', to: '/verify-certificate' },
  ];

  return (
    <>
      <AppHeader icon={<ShieldAlert size={22} color="#fff" />} title="Security" tagline="Forensics · Monitoring · Protection" />

      <div className="pa-stats" style={{ marginBottom: 6 }}>
        {stats.map((s) => (
          <div className="pa-stat" key={s.l}>
            <div className="pa-stat-ic" style={{ background: s.c + '22' }}><s.icon size={16} color={s.c} /></div>
            <div className="pa-stat-n">{s.n}</div><div className="pa-stat-l">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="pa-section"><h2>All Tools</h2></div>
      <div className="pa-card">
        {tools.map((t) => (
          <div className="pa-row" key={t.t} onClick={() => navigate(t.to)} style={{ cursor: 'pointer' }}>
            <div className="pa-row-ic" style={{ background: 'rgba(124,108,240,0.14)' }}><t.icon size={18} color="var(--primary)" /></div>
            <div style={{ minWidth: 0, flex: 1 }}><div className="pa-row-t">{t.t}</div><div className="pa-row-s">{t.s}</div></div>
            <span className={`pa-pill ${t.cls}`}>{t.pill}</span>
            <ChevronRight size={16} color="var(--muted)" />
          </div>
        ))}
      </div>
    </>
  );
}
