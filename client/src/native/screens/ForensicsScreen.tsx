import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert, ShieldCheck, FileText, EyeOff, Copy, Activity, AlertTriangle, ChevronRight,
  Radio, LayoutDashboard, Search, Eye, Clock, Award, RefreshCw, Globe, Users,
} from 'lucide-react';
import { AppHeader } from './parts';
import { API_BASE_URL } from '../../config/api.config';
import axios from 'axios';

interface Stats {
  totalViews: number; uniqueRecipients: number; countriesReached: number;
  downloads: number; screenshotAttempts: number; copyAttempts: number;
}
interface MonStats { totalMonitored: number; activeMonitors: number; totalRuns: number; exactMatches: number; }

export function ForensicsScreen() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [monStats, setMonStats] = useState<MonStats | null>(null);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('pinit_access_token');
  const headers = { Authorization: `Bearer ${token}` };

  function load() {
    setLoading(true);
    Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      axios.get(`${API_BASE_URL}/share/analytics/global`, { headers, timeout: 30000 }).then((r: any) => setStats(r.data?.stats)).catch(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      axios.get(`${API_BASE_URL}/monitor/stats`, { headers, timeout: 30000 }).then((r: any) => setMonStats(r.data)).catch(() => {}),
    ]).then(() => setLoading(false)).catch(() => setLoading(false));
  }
  useEffect(load, []);

  const tools = [
    { t: 'Forensic Dashboard', s: 'Recipients, forward detection, risk', icon: LayoutDashboard, pill: 'Open', cls: 'violet', to: '/forensic-dashboard' },
    { t: 'Monitoring & Crawler', s: `${monStats?.totalMonitored ?? 0} files · ${monStats?.totalRuns ?? 0} runs`, icon: Radio, pill: monStats?.activeMonitors ? `${monStats.activeMonitors} Active` : 'Open', cls: 'green', to: '/monitoring' },
    { t: 'Security Center', s: 'Incidents, evidence, leak attribution', icon: ShieldCheck, pill: 'Open', cls: 'blue', to: '/security-center' },
    { t: 'Forensic Reports', s: 'View and export analysis reports', icon: FileText, pill: 'Open', cls: 'blue', to: '/reports' },
    { t: 'Unmask Requests', s: 'Review identity unmask requests', icon: EyeOff, pill: 'Open', cls: 'amber', to: '/unmask-requests' },
    { t: 'Duplicate Attempts', s: 'Detect duplicate or reused files', icon: Copy, pill: 'Open', cls: 'red', to: '/duplicate-attempts' },
    { t: 'Vault Integrity', s: 'Check vault health & tamper logs', icon: Activity, pill: 'Open', cls: 'green', to: '/vault-integrity' },
    { t: 'Verify Leaked File', s: 'Upload to identify original owner', icon: Search, pill: 'Open', cls: 'violet', to: '/verify-leaked' },
    { t: 'Access Intelligence', s: 'Per-link analytics & revoke', icon: Eye, pill: 'Open', cls: 'blue', to: '/access-intelligence' },
    { t: 'File Timeline', s: 'Complete lifecycle audit trail', icon: Clock, pill: 'Open', cls: 'violet', to: '/timeline' },
    { t: 'Certificates', s: 'Ownership and verification proofs', icon: Award, pill: 'Open', cls: 'green', to: '/certificates' },
    { t: 'Verify Certificate', s: 'Check certificate authenticity', icon: ShieldCheck, pill: 'Open', cls: 'violet', to: '/verify-certificate' },
  ];

  return (
    <>
      <AppHeader icon={<ShieldAlert size={22} color="#fff" />} title="Security" tagline="Forensics · Monitoring · Protection" />

      {/* Live stats */}
      <div className="pa-stats" style={{ marginBottom: 6 }}>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(59,130,246,0.14)' }}><Eye size={16} color="#3b82f6" /></div><div className="pa-stat-n">{stats?.totalViews ?? 0}</div><div className="pa-stat-l">Views</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(139,92,246,0.14)' }}><Users size={16} color="#8b5cf6" /></div><div className="pa-stat-n">{stats?.uniqueRecipients ?? 0}</div><div className="pa-stat-l">Recipients</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><Globe size={16} color="#10b981" /></div><div className="pa-stat-n">{stats?.countriesReached ?? 0}</div><div className="pa-stat-l">Countries</div></div>
        <div className="pa-stat"><div className="pa-stat-ic" style={{ background: 'rgba(239,68,68,0.14)' }}><AlertTriangle size={16} color="#ef4444" /></div><div className="pa-stat-n">{monStats?.exactMatches ?? 0}</div><div className="pa-stat-l">Matches</div></div>
      </div>

      {/* Monitoring card */}
      {monStats && (monStats.totalMonitored > 0) && (
        <div className="pa-card" style={{ padding: 16, marginBottom: 12 }} onClick={() => navigate('/monitoring')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="pa-row-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><Radio size={18} color="#10b981" /></div>
            <div style={{ flex: 1 }}>
              <div className="pa-row-t">Monitoring & Crawler</div>
              <div className="pa-row-s">{monStats.totalMonitored} files monitored · {monStats.activeMonitors} active · {monStats.totalRuns} runs</div>
            </div>
            <span className="pa-pill green">Live</span>
          </div>
        </div>
      )}

      {/* Tracking card */}
      {stats && (stats.totalViews > 0) && (
        <div className="pa-card" style={{ padding: 16, marginBottom: 12 }} onClick={() => navigate('/forensic-dashboard')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="pa-row-ic" style={{ background: 'rgba(99,102,241,0.14)' }}><LayoutDashboard size={18} color="#6366f1" /></div>
            <div style={{ flex: 1 }}>
              <div className="pa-row-t">Tracking Activity</div>
              <div className="pa-row-s">{stats.totalViews} views · {stats.downloads} downloads · {stats.copyAttempts} copy attempts</div>
            </div>
            <span className="pa-pill blue">Active</span>
          </div>
        </div>
      )}

      {/* All Tools */}
      <div className="pa-section">
        <h2>All Tools</h2>
        <button className="pa-link" onClick={load} style={{ background: 'none', border: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={14} className={loading ? 'pa-spin' : ''} /> Refresh
        </button>
      </div>
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
