import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, AlertTriangle, CheckCircle2, Clock, Activity, RefreshCw, Plus } from 'lucide-react';
import { AppHeader } from './parts';
import { API_BASE_URL } from '../../config/api.config';
import axios from 'axios';

interface Stats { monitored: number; active: number; totalRuns: number; exactMatches: number; pending: number; confirmed: number; }

export function MonitorScreen() {
  const navigate = useNavigate();
  const [s, setS] = useState<Stats>({ monitored: 0, active: 0, totalRuns: 0, exactMatches: 0, pending: 0, confirmed: 0 });
  const [, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const token = localStorage.getItem('pinit_access_token');
    axios.get(`${API_BASE_URL}/monitoring/stats`, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: any) => {
        const d = data.stats || data.data || data;
        setS({
          monitored: d.monitored ?? d.totalMonitored ?? 0,
          active: d.active ?? d.activeMonitors ?? 0,
          totalRuns: d.totalRuns ?? 0,
          exactMatches: d.exactMatches ?? 0,
          pending: d.pending ?? 0,
          confirmed: d.confirmed ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const stats = [
    { n: s.monitored, l: 'Monitored', icon: Radio, c: '#6366f1' },
    { n: s.active, l: 'Active', icon: Activity, c: '#10b981' },
    { n: s.totalRuns, l: 'Total Runs', icon: Clock, c: '#3b82f6' },
    { n: s.exactMatches, l: 'Matches', icon: AlertTriangle, c: '#ef4444' },
  ];

  return (
    <>
      <AppHeader icon={<Radio size={22} color="#fff" />} title="Monitoring" tagline="Watch. Detect. Alert." />

      {/* Stats */}
      <div className="pa-stats" style={{ marginBottom: 6 }}>
        {stats.map((st) => (
          <div className="pa-stat" key={st.l}>
            <div className="pa-stat-ic" style={{ background: st.c + '22' }}><st.icon size={16} color={st.c} /></div>
            <div className="pa-stat-n">{st.n}</div><div className="pa-stat-l">{st.l}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="pa-section"><h2>Actions</h2></div>
      <div className="pa-actions">
        <div className="pa-action" onClick={() => navigate('/monitoring')}>
          <div className="pa-action-ic" style={{ background: 'rgba(99,102,241,0.14)' }}><Radio size={20} color="var(--primary)" /></div>
          <div className="pa-action-t">Monitor All</div>
        </div>
        <div className="pa-action" onClick={() => navigate('/monitoring')}>
          <div className="pa-action-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><Plus size={20} color="#10b981" /></div>
          <div className="pa-action-t">Enroll File</div>
        </div>
        <div className="pa-action" onClick={() => navigate('/monitoring')}>
          <div className="pa-action-ic" style={{ background: 'rgba(245,158,11,0.16)' }}><AlertTriangle size={20} color="#f59e0b" /></div>
          <div className="pa-action-t">Alerts</div>
        </div>
        <div className="pa-action" onClick={() => navigate('/monitoring')}>
          <div className="pa-action-ic" style={{ background: 'rgba(59,130,246,0.14)' }}><RefreshCw size={20} color="#3b82f6" /></div>
          <div className="pa-action-t">Full Page</div>
        </div>
      </div>

      {/* Status */}
      <div className="pa-section"><h2>Status</h2></div>
      <div className="pa-card">
        <div className="pa-row">
          <div className="pa-row-ic" style={{ background: 'rgba(16,185,129,0.14)' }}><CheckCircle2 size={18} color="#10b981" /></div>
          <div style={{ flex: 1 }}><div className="pa-row-t">Match Alerts</div><div className="pa-row-s">{s.pending} pending · {s.confirmed} confirmed</div></div>
          <span className={`pa-pill ${s.pending > 0 ? 'amber' : 'green'}`}>{s.pending > 0 ? `${s.pending} Pending` : 'Clear'}</span>
        </div>
        <div className="pa-row" onClick={() => navigate('/monitoring')}>
          <div className="pa-row-ic" style={{ background: 'rgba(99,102,241,0.12)' }}><Radio size={18} color="var(--primary)" /></div>
          <div style={{ flex: 1 }}><div className="pa-row-t">Monitored Files</div><div className="pa-row-s">{s.monitored} files tracked · {s.active} active</div></div>
          <span className="pa-pill green">Active</span>
        </div>
      </div>

      {/* Open full page */}
      <button
        onClick={() => navigate('/monitoring')}
        style={{ width: '100%', marginTop: 16, padding: '14px', borderRadius: 14, border: 0, fontWeight: 700, fontSize: 14, color: '#fff', background: 'linear-gradient(135deg, var(--primary), var(--primary-2))', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        <Radio size={17} /> Open Full Monitoring Dashboard
      </button>
    </>
  );
}
