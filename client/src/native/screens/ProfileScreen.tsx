import { useNavigate } from 'react-router-dom';
import {
  User, ShieldCheck, Award, FileSearch, Settings, Moon, Sun, LogOut, ChevronRight, Fingerprint, Copy,
} from 'lucide-react';
import { AppHeader } from './parts';
import { useTheme } from '../theme';
import { useAuth } from '../../context/AuthContext';
import { getHoid, getTrustScore } from '../../lib/hoid';

export function ProfileScreen() {
  const navigate = useNavigate();
  const { mode, toggle } = useTheme();
  const { user, logout } = useAuth();
  const hoid = getHoid() ?? 'HOID-not-set';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shortId = (user as any)?.shortId ?? user?.sub?.slice(0, 12) ?? 'PINIT-USER';

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <AppHeader icon={<User size={22} color="#fff" />} title="Profile" tagline="Your Human Origin Identity" />

      {/* Identity card */}
      <div className="pa-hero" style={{ textAlign: 'center' }}>
        <Fingerprint className="pa-hero-helix" size={170} color="#a78bfa" strokeWidth={1} />
        <div style={{ width: 66, height: 66, borderRadius: '50%', margin: '4px auto 12px', background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <User size={32} color="#fff" />
        </div>
        <div style={{ fontSize: 19, fontWeight: 800 }}>PINIT User</div>
        <div className="mono" style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>{shortId}</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, padding: '7px 14px', borderRadius: 999, background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.35)' }}>
          <ShieldCheck size={15} color="#6ee7b7" /><span style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7' }}>Trust Score: {getTrustScore().toFixed(1)}%</span>
        </div>
      </div>

      {/* HOID */}
      <div className="pa-card" style={{ marginTop: 16, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Human Origin Identity</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', flex: 1, wordBreak: 'break-all' }}>{hoid}</span>
          <button className="pa-icon-btn" style={{ width: 36, height: 36 }} onClick={() => navigator.clipboard?.writeText(hoid)}><Copy size={15} /></button>
        </div>
      </div>

      {/* Settings */}
      <div className="pa-section"><h2>Settings</h2></div>
      <div className="pa-card">
        <button className="pa-setrow" onClick={toggle}>
          <div className="pa-row-ic" style={{ background: 'rgba(124,108,240,0.16)' }}>{mode === 'dark' ? <Moon size={17} color="#8b80f8" /> : <Sun size={17} color="#8b80f8" />}</div>
          <span style={{ flex: 1 }}>Appearance</span>
          <span className="pa-pill violet">{mode === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
        <SetRow icon={<Award size={17} color="#3b82f6" />} bg="rgba(59,130,246,0.14)" label="My Certificates" onClick={() => navigate('/certificates')} />
        <SetRow icon={<FileSearch size={17} color="#10b981" />} bg="rgba(16,185,129,0.14)" label="DNA Records" onClick={() => navigate('/dna-records')} />
        <SetRow icon={<ShieldCheck size={17} color="#f59e0b" />} bg="rgba(245,158,11,0.16)" label="Security Center" onClick={() => navigate('/security-center')} />
        <SetRow icon={<Settings size={17} color="#8b80f8" />} bg="rgba(124,108,240,0.16)" label="Account Details" onClick={() => navigate('/profile')} />
        <SetRow icon={<Award size={17} color="#10b981" />} bg="rgba(16,185,129,0.14)" label="Verify Certificate" onClick={() => navigate('/verify-certificate')} />
        <SetRow icon={<FileSearch size={17} color="#ef4444" />} bg="rgba(239,68,68,0.14)" label="Verify Leaked File" onClick={() => navigate('/verify-leaked')} />
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        style={{ width: '100%', marginTop: 16, padding: '14px', borderRadius: 14, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.10)', color: '#ef4444', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        <LogOut size={17} /> Sign Out
      </button>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', marginTop: 16 }}>PINIT DNA · Human Origin Identity</div>
    </>
  );
}

function SetRow({ icon, bg, label, onClick }: { icon: React.ReactNode; bg: string; label: string; onClick: () => void }) {
  return (
    <button className="pa-setrow" onClick={onClick}>
      <div className="pa-row-ic" style={{ background: bg }}>{icon}</div>
      <span style={{ flex: 1 }}>{label}</span>
      <ChevronRight size={17} color="var(--muted)" />
    </button>
  );
}
