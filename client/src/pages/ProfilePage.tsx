import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  User, Shield, Bell, Clock, Activity, Save, RefreshCw,
  Dna, Archive, Share2, Award, Eye, Radio, Lock, Trash2,
  Sun, Moon, Monitor,
} from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { useTheme } from '../hooks/useTheme';
import { formatDistanceToNow, format } from 'date-fns';

type Tab = 'profile' | 'security' | 'notifications' | 'activity' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile',       label: 'Profile',       icon: <User size={14} /> },
  { id: 'security',      label: 'Security',      icon: <Shield size={14} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={14} /> },
  { id: 'activity',      label: 'Activity',      icon: <Clock size={14} /> },
  { id: 'settings',      label: 'Settings',      icon: <Activity size={14} /> },
];

export function ProfilePage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'profile');
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`${API_BASE_URL}/profile`).then(r => setProfile((r.data as any).profile)),
      api.get(`${API_BASE_URL}/profile/stats`).then(r => setStats((r.data as any).stats)),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const t = params.get('tab') as Tab;
    if (t && TABS.some(x => x.id === t)) setTab(t);
  }, [params]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <RefreshCw size={24} className="animate-spin text-dna-400" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header with stats */}
      <div className="card mb-6">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-dna-500 to-purple flex items-center justify-center text-xl font-bold text-white shrink-0">
            {profile?.fullName?.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || 'P'}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white">{profile?.fullName}</h1>
            <p className="text-sm text-dna-400 font-mono">{profile?.shortId}</p>
            {profile?.email && <p className="text-xs text-gray-500">{profile.email}</p>}
            {profile?.organization && <p className="text-xs text-gray-500">{profile.organization}{profile.jobTitle ? ` · ${profile.jobTitle}` : ''}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xs text-gray-500">Member since</p>
            <p className="text-xs text-gray-400">{profile?.createdAt ? format(new Date(profile.createdAt), 'MMM d, yyyy') : ''}</p>
          </div>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">
            <StatMini icon={<Dna size={12} />} label="DNA" value={stats.dnaGenerated} />
            <StatMini icon={<Archive size={12} />} label="Vault" value={stats.filesProtected} />
            <StatMini icon={<Share2 size={12} />} label="Shares" value={stats.activeShares} />
            <StatMini icon={<Eye size={12} />} label="Access" value={stats.accessEvents} />
            <StatMini icon={<Radio size={12} />} label="Monitor" value={stats.monitoringJobs} />
            <StatMini icon={<Award size={12} />} label="Certs" value={stats.certificates} />
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              tab === t.id ? 'bg-dna-500/20 text-dna-400 border border-dna-500/30' : 'text-gray-500 hover:text-white hover:bg-bg-elevated'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'profile'       && <ProfileTab profile={profile} onUpdate={setProfile} />}
      {tab === 'security'      && <SecurityTab profile={profile} />}
      {tab === 'notifications' && <NotificationsTab profile={profile} onUpdate={setProfile} />}
      {tab === 'activity'      && <ActivityTab />}
      {tab === 'settings'      && <SettingsTab />}
    </div>
  );
}

// ── Profile Tab ────────────────────────────────────────────────────────────────

function ProfileTab({ profile, onUpdate }: { profile: any; onUpdate: (p: any) => void }) {
  const [form, setForm] = useState({
    fullName: profile?.fullName ?? '',
    phone: profile?.phone ?? '',
    organization: profile?.organization ?? '',
    jobTitle: profile?.jobTitle ?? '',
    country: profile?.country ?? '',
    bio: profile?.bio ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`${API_BASE_URL}/profile`, form);
      onUpdate({ ...profile, ...(data as any).profile });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2"><User size={14} className="text-dna-400" /> Personal Information</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Full Name" value={form.fullName} onChange={v => setForm({ ...form, fullName: v })} />
        <Field label="PINIT ID" value={profile?.shortId} disabled />
        <Field label="Email" value={profile?.email ?? ''} disabled />
        <Field label="Phone" value={form.phone} onChange={v => setForm({ ...form, phone: v })} placeholder="+91 9876543210" />
        <Field label="Organization" value={form.organization} onChange={v => setForm({ ...form, organization: v })} placeholder="Company name" />
        <Field label="Job Title" value={form.jobTitle} onChange={v => setForm({ ...form, jobTitle: v })} placeholder="Software Engineer" />
        <Field label="Country" value={form.country} onChange={v => setForm({ ...form, country: v })} placeholder="India" />
      </div>

      <div>
        <label className="text-2xs text-gray-500 font-medium mb-1 block">Bio</label>
        <textarea
          value={form.bio}
          onChange={e => setForm({ ...form, bio: e.target.value })}
          className="w-full px-3 py-2 bg-bg-elevated border border-bg-border rounded-lg text-xs text-white resize-none h-20 focus:outline-none focus:border-dna-500"
          placeholder="Tell us about yourself..."
        />
      </div>

      <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm text-xs">
        {saving ? <RefreshCw size={12} className="animate-spin" /> : saved ? '✓ Saved' : <><Save size={12} /> Save Changes</>}
      </button>
    </div>
  );
}

// ── Security Tab ────────────────────────────────────────────────────────────────

function SecurityTab({ profile }: { profile: any }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [changingPw, setChangingPw] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');

  useEffect(() => {
    api.get(`${API_BASE_URL}/profile/sessions`).then(r => {
      setSessions((r.data as any).sessions ?? []);
      setLoadingSessions(false);
    }).catch(() => setLoadingSessions(false));
  }, []);

  const handlePasswordChange = async () => {
    if (pwForm.newPassword !== pwForm.confirm) { setPwMsg('Passwords do not match'); return; }
    if (pwForm.newPassword.length < 8) { setPwMsg('Minimum 8 characters'); return; }
    setChangingPw(true);
    try {
      await api.put(`${API_BASE_URL}/profile/password`, { currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      setPwMsg('✓ Password updated');
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch { setPwMsg('Failed to update password'); }
    finally { setChangingPw(false); }
  };

  const revokeAll = async () => {
    await api.delete(`${API_BASE_URL}/profile/sessions`);
    setSessions([]);
  };

  return (
    <div className="space-y-4">
      {/* Security Overview */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><Shield size={14} className="text-dna-400" /> Security Overview</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SecurityItem label="Password" value={profile?.passwordHash ? 'Set' : 'Not set'} ok={!!profile?.passwordHash} />
          <SecurityItem label="Last Login" value={profile?.lastLoginAt ? formatDistanceToNow(new Date(profile.lastLoginAt)) + ' ago' : 'Never'} ok={true} />
          <SecurityItem label="2FA" value="Not enabled" ok={false} />
          <SecurityItem label="Active Sessions" value={String(sessions.length)} ok={true} />
        </div>
      </div>

      {/* Change Password */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><Lock size={14} className="text-dna-400" /> Change Password</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Current Password" value={pwForm.currentPassword} onChange={v => setPwForm({ ...pwForm, currentPassword: v })} type="password" />
          <Field label="New Password" value={pwForm.newPassword} onChange={v => setPwForm({ ...pwForm, newPassword: v })} type="password" />
          <Field label="Confirm" value={pwForm.confirm} onChange={v => setPwForm({ ...pwForm, confirm: v })} type="password" />
        </div>
        {pwMsg && <p className={`text-2xs mt-2 ${pwMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{pwMsg}</p>}
        <button onClick={handlePasswordChange} disabled={changingPw} className="btn btn-primary btn-sm text-xs mt-3">
          {changingPw ? <RefreshCw size={12} className="animate-spin" /> : 'Update Password'}
        </button>
      </div>

      {/* Sessions */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Monitor size={14} className="text-dna-400" /> Active Sessions</h2>
          {sessions.length > 0 && (
            <button onClick={revokeAll} className="text-2xs text-red-400 hover:text-red-300 flex items-center gap-1">
              <Trash2 size={10} /> Revoke All
            </button>
          )}
        </div>
        {loadingSessions ? (
          <div className="text-center py-4"><RefreshCw size={16} className="animate-spin text-dna-400 mx-auto" /></div>
        ) : sessions.length === 0 ? (
          <p className="text-2xs text-gray-500 text-center py-4">No active sessions</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s, i) => (
              <div key={s.id} className="flex items-center justify-between bg-bg-elevated rounded-lg px-3 py-2 border border-bg-border">
                <div className="flex items-center gap-2">
                  <Monitor size={12} className="text-gray-500" />
                  <div>
                    <p className="text-xs text-white">Session {i + 1}</p>
                    <p className="text-2xs text-gray-500">Created {formatDistanceToNow(new Date(s.loginAt))} ago</p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    await api.delete(`${API_BASE_URL}/profile/session/${s.id}`);
                    setSessions(prev => prev.filter(x => x.id !== s.id));
                  }}
                  className="text-2xs text-red-400 hover:text-red-300"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Notifications Tab ──────────────────────────────────────────────────────────

function NotificationsTab({ profile, onUpdate }: { profile: any; onUpdate: (p: any) => void }) {
  const [prefs, setPrefs] = useState({
    notifyShareAccess: profile?.notifyShareAccess ?? true,
    notifyRiskAlerts: profile?.notifyRiskAlerts ?? true,
    notifyCertificates: profile?.notifyCertificates ?? true,
    notifyMonitoring: profile?.notifyMonitoring ?? true,
    notifyUpdates: profile?.notifyUpdates ?? false,
  });

  const toggle = async (key: string) => {
    const updated = { ...prefs, [key]: !(prefs as any)[key] };
    setPrefs(updated);
    await api.put(`${API_BASE_URL}/profile/notifications`, updated);
    onUpdate({ ...profile, ...updated });
  };

  const items = [
    { key: 'notifyShareAccess', label: 'Share Access Alerts', desc: 'When someone views or downloads your shared files' },
    { key: 'notifyRiskAlerts', label: 'Risk Alerts', desc: 'When suspicious activity is detected on your files' },
    { key: 'notifyCertificates', label: 'Certificate Alerts', desc: 'When new certificates are generated' },
    { key: 'notifyMonitoring', label: 'Monitoring Alerts', desc: 'When monitoring crawlers find matches' },
    { key: 'notifyUpdates', label: 'Product Updates', desc: 'News about PINIT-DNA features and improvements' },
  ];

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><Bell size={14} className="text-dna-400" /> Notification Preferences</h2>
      <div className="space-y-3">
        {items.map(item => (
          <div key={item.key} className="flex items-center justify-between bg-bg-elevated rounded-lg px-4 py-3 border border-bg-border">
            <div>
              <p className="text-xs font-medium text-white">{item.label}</p>
              <p className="text-2xs text-gray-500">{item.desc}</p>
            </div>
            <button
              onClick={() => toggle(item.key)}
              className={`w-9 h-5 rounded-full transition-colors relative ${(prefs as any)[item.key] ? 'bg-dna-500' : 'bg-gray-600'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${(prefs as any)[item.key] ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Activity Tab ────────────────────────────────────────────────────────────────

function ActivityTab() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`${API_BASE_URL}/profile/activity`).then(r => {
      setEvents((r.data as any).events ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const typeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    DNA_GENERATED: { icon: <Dna size={12} />, color: 'text-dna-400 bg-dna-500/20', label: 'DNA Generated' },
    VAULT_UPLOAD:  { icon: <Archive size={12} />, color: 'text-green-400 bg-green-500/20', label: 'Vault Upload' },
    SHARE_CREATED: { icon: <Share2 size={12} />, color: 'text-blue-400 bg-blue-500/20', label: 'Share Created' },
    CERT_GENERATED:{ icon: <Award size={12} />, color: 'text-purple-400 bg-purple-500/20', label: 'Certificate Generated' },
    ACCESS_VIEWED: { icon: <Eye size={12} />, color: 'text-yellow-400 bg-yellow-500/20', label: 'File Viewed' },
    ACCESS_DOWNLOADED: { icon: <Archive size={12} />, color: 'text-orange-400 bg-orange-500/20', label: 'File Downloaded' },
    RISK_EVENT:    { icon: <Shield size={12} />, color: 'text-red-400 bg-red-500/20', label: 'Risk Event' },
  };

  if (loading) return <div className="text-center py-8"><RefreshCw size={16} className="animate-spin text-dna-400 mx-auto" /></div>;

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><Clock size={14} className="text-dna-400" /> Activity Timeline</h2>
      {events.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-8">No activity yet</p>
      ) : (
        <div className="space-y-2">
          {events.map((ev, i) => {
            const cfg = typeConfig[ev.type] ?? { icon: <Activity size={12} />, color: 'text-gray-400 bg-gray-500/20', label: ev.type };
            return (
              <div key={i} className="flex items-start gap-3 bg-bg-elevated rounded-lg px-3 py-2.5 border border-bg-border">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${cfg.color}`}>
                  {cfg.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white">{cfg.label}</p>
                  <p className="text-2xs text-gray-500 truncate">{ev.detail}</p>
                </div>
                <p className="text-2xs text-gray-600 shrink-0">{formatDistanceToNow(new Date(ev.date))} ago</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Settings Tab ────────────────────────────────────────────────────────────────

function SettingsTab() {
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><Activity size={14} className="text-dna-400" /> App Settings</h2>

      <div className="space-y-3">
        {/* Theme toggle */}
        <div className="flex items-center justify-between bg-bg-elevated rounded-lg px-4 py-3 border border-bg-border">
          <div className="flex items-center gap-3">
            {theme === 'dark' ? <Moon size={14} className="text-dna-400" /> : <Sun size={14} className="text-dna-400" />}
            <div>
              <p className="text-xs font-medium text-white">Theme</p>
              <p className="text-2xs text-gray-500">Switch between light and dark mode</p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className={`w-9 h-5 rounded-full transition-colors relative ${theme === 'dark' ? 'bg-dna-500' : 'bg-gray-400'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${theme === 'dark' ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        {/* Account Info */}
        <div className="bg-bg-elevated rounded-lg px-4 py-3 border border-bg-border">
          <p className="text-xs font-medium text-white mb-2">Account</p>
          <div className="space-y-1 text-2xs text-gray-500">
            <p>Account Type: <span className="text-gray-400">Free</span></p>
            <p>API Keys: <span className="text-gray-400">Coming Soon</span></p>
            <p>Billing: <span className="text-gray-400">Coming Soon</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared components ──────────────────────────────────────────────────────────

function Field({ label, value, onChange, disabled, placeholder, type }: {
  label: string; value: string; onChange?: (v: string) => void; disabled?: boolean; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="text-2xs text-gray-500 font-medium mb-1 block">{label}</label>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={onChange ? e => onChange(e.target.value) : undefined}
        disabled={disabled}
        placeholder={placeholder}
        className={`w-full px-3 py-2 bg-bg-elevated border border-bg-border rounded-lg text-xs text-white focus:outline-none focus:border-dna-500 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      />
    </div>
  );
}

function StatMini({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-bg-elevated border border-bg-border rounded-lg p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-dna-400 mb-0.5">{icon}</div>
      <p className="text-sm font-bold text-white">{value}</p>
      <p className="text-2xs text-gray-500">{label}</p>
    </div>
  );
}

function SecurityItem({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="bg-bg-elevated border border-bg-border rounded-lg p-3 text-center">
      <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${ok ? 'bg-green-400' : 'bg-yellow-400'}`} />
      <p className="text-2xs text-gray-500">{label}</p>
      <p className="text-xs font-medium text-white">{value}</p>
    </div>
  );
}
