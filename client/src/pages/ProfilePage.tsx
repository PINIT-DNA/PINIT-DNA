import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  User, Shield, Bell, Clock, Activity, Save, RefreshCw,
  Dna, Archive, Share2, Award, Eye, Radio, Trash2,
  Sun, Moon, Monitor,
} from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { useTheme } from '../hooks/useTheme';
import { useSubscription } from '../hooks/useSubscription';
import { BusinessProfileHub } from './business/BusinessProfileHub';
import { formatDistanceToNow, format } from 'date-fns';
import {
  type NotificationItem,
  notificationTypeConfig,
  NOTIFICATION_SEVERITY_BORDER,
  resolveNotificationDeepLink,
} from '../lib/notification-config';

type Tab = 'profile' | 'security' | 'notifications' | 'activity' | 'settings';

const BASE_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <User size={14} /> },
  { id: 'security', label: 'Security', icon: <Shield size={14} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={14} /> },
  { id: 'activity', label: 'Activity', icon: <Clock size={14} /> },
  { id: 'settings', label: 'Settings', icon: <Activity size={14} /> },
];

export function ProfilePage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'profile');
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { accountType } = useSubscription();

  const isBusiness = accountType === 'BUSINESS' || profile?.accountType === 'BUSINESS';

  const tabs = BASE_TABS;

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProfile = () => {
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const { data } = await api.get(`${API_BASE_URL}/profile`);
        const p = (data as { profile?: unknown }).profile;
        if (p) setProfile(p);
        else setLoadError('Profile data was empty. Try again.');
      } catch {
        setLoadError('Profile could not be loaded. The backend may be busy — try again.');
      } finally {
        setLoading(false);
      }
    })();

    void api
      .get(`${API_BASE_URL}/profile/stats`)
      .then((r) => setStats((r.data as { stats?: unknown }).stats))
      .catch(() => {});
  };

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    const t = params.get('tab') as Tab;
    if (t && tabs.some(x => x.id === t)) setTab(t);
  }, [params, isBusiness]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <RefreshCw size={24} className="animate-spin text-dna-400" />
      <p className="text-xs text-gray-500">Loading profile…</p>
    </div>
  );

  if (!profile && loadError) {
    return (
      <div className="page-shell max-w-lg mx-auto text-center py-16">
        <p className="text-sm text-amber-200 mb-4">{loadError}</p>
        <button
          type="button"
          onClick={loadProfile}
          className="text-xs px-4 py-2 rounded-lg bg-dna-500 text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  if (isBusiness && profile) {
    return <BusinessProfileHub profile={profile} stats={stats} />;
  }

  return (
    <div className="page-shell w-full max-w-5xl">
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

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mt-4">
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
        {tabs.map(t => (
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
      {tab === 'profile' && <ProfileTab profile={profile} onUpdate={setProfile} />}
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
  useEffect(() => {
    api.get(`${API_BASE_URL}/profile/sessions`).then(r => {
      setSessions((r.data as any).sessions ?? []);
      setLoadingSessions(false);
    }).catch(() => setLoadingSessions(false));
  }, []);


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
          <SecurityItem label="Auth Method" value="Biometric (PINIT HOID)" ok={true} />
          <SecurityItem label="Last Login" value={profile?.lastLoginAt ? formatDistanceToNow(new Date(profile.lastLoginAt)) + ' ago' : 'Never'} ok={true} />
          <SecurityItem label="2FA" value="Not enabled" ok={false} />
          <SecurityItem label="Active Sessions" value={String(sessions.length)} ok={true} />
        </div>
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
  return (
    <div className="space-y-4">
      <NotificationPreferences profile={profile} onUpdate={onUpdate} />
      <NotificationHistoryPanel />
    </div>
  );
}

function NotificationPreferences({ profile, onUpdate }: { profile: any; onUpdate: (p: any) => void }) {
  const [prefs, setPrefs] = useState({
    notifyShareAccess: profile?.notifyShareAccess ?? true,
    notifyRiskAlerts: profile?.notifyRiskAlerts ?? true,
    notifyCertificates: profile?.notifyCertificates ?? true,
    notifyMonitoring: profile?.notifyMonitoring ?? true,
    notifyVault: profile?.notifyVault ?? true,
    notifyDna: profile?.notifyDna ?? true,
    notifyInvestigation: profile?.notifyInvestigation ?? true,
    notifyAutomation: profile?.notifyAutomation ?? true,
    notifySecurity: profile?.notifySecurity ?? true,
    notifyReports: profile?.notifyReports ?? true,
    notifySystem: profile?.notifySystem ?? true,
    notifyUpdates: profile?.notifyUpdates ?? false,
  });

  const toggle = async (key: string) => {
    const updated = { ...prefs, [key]: !(prefs as any)[key] };
    setPrefs(updated);
    await api.put(`${API_BASE_URL}/profile/notifications`, updated);
    onUpdate({ ...profile, ...updated });
  };

  const items = [
    { key: 'notifyVault', label: 'Vault', desc: 'Storage, encryption issues, protected downloads, TEP events' },
    { key: 'notifyDna', label: 'DNA', desc: 'DNA generated, verification results, and mismatches' },
    { key: 'notifyCertificates', label: 'Certificates', desc: 'Issued, revoked, expired, and validation failures' },
    { key: 'notifyShareAccess', label: 'Secure Share', desc: 'Link views, downloads, forwards, revokes, and expiry' },
    { key: 'notifyMonitoring', label: 'Monitoring & Crawler', desc: 'Matches, scan completion, and crawler errors' },
    { key: 'notifyRiskAlerts', label: 'AI Detection & Risk', desc: 'Policy blocks, tampering, copy/screenshot attempts' },
    { key: 'notifyInvestigation', label: 'Investigation', desc: 'Investigation started, completed, and failed' },
    { key: 'notifyAutomation', label: 'Automation', desc: 'Scheduled scans and automated task completion' },
    { key: 'notifySecurity', label: 'Security', desc: 'Login events, password changes, and session revokes' },
    { key: 'notifyReports', label: 'Reports', desc: 'Report generated, downloaded, and shared' },
    { key: 'notifySystem', label: 'System', desc: 'Registration, storage warnings, and maintenance notices' },
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

function NotificationHistoryPanel() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'createdAt' | 'severity'>('createdAt');
  const [includeArchived, setIncludeArchived] = useState(false);
  const navigate = useNavigate();

  const load = async (offset = 0, append = false) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: '25', offset: String(offset), sort });
      if (filter === 'unread') params.set('unread', 'true');
      if (category) params.set('category', category);
      if (search.trim()) params.set('q', search.trim());
      if (includeArchived) params.set('includeArchived', 'true');
      const { data } = await api.get(`${API_BASE_URL}/notifications?${params}`);
      const payload = data as {
        notifications?: NotificationItem[];
        hasMore?: boolean;
      };
      const batch = payload.notifications ?? [];
      setItems(prev => append ? [...prev, ...batch] : batch);
      setHasMore(!!payload.hasMore);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { load(0, false); }, [filter, category, sort, includeArchived]);

  const markAllRead = async () => {
    await api.put(`${API_BASE_URL}/notifications/read-all`);
    load(0, false);
  };

  const archiveItem = async (id: string) => {
    await api.put(`${API_BASE_URL}/notifications/${id}/archive`);
    setItems(prev => prev.filter(n => n.id !== id));
  };

  const categories = ['', 'sharing', 'security', 'vault', 'monitoring', 'certificates', 'investigation', 'account', 'automation'];

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Bell size={14} className="text-dna-400" /> Notification History
        </h2>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(0, false)}
            placeholder="Search notifications…"
            className="text-2xs bg-bg-elevated border border-bg-border rounded px-2 py-1 text-gray-300 min-w-[140px] flex-1"
          />
          <button onClick={() => load(0, false)} className="text-2xs text-dna-400 hover:text-white px-2 py-1 rounded border border-bg-border">
            Search
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as 'createdAt' | 'severity')}
            className="text-2xs bg-bg-elevated border border-bg-border rounded px-2 py-1 text-gray-300"
          >
            <option value="createdAt">Newest first</option>
            <option value="severity">By severity</option>
          </select>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as 'all' | 'unread')}
            className="text-2xs bg-bg-elevated border border-bg-border rounded px-2 py-1 text-gray-300"
          >
            <option value="all">All</option>
            <option value="unread">Unread only</option>
          </select>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="text-2xs bg-bg-elevated border border-bg-border rounded px-2 py-1 text-gray-300"
          >
            {categories.map(c => (
              <option key={c || 'all'} value={c}>{c ? c.charAt(0).toUpperCase() + c.slice(1) : 'All categories'}</option>
            ))}
          </select>
          <label className="text-2xs text-gray-500 flex items-center gap-1">
            <input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)} />
            Archived
          </label>
          <button onClick={markAllRead} className="text-2xs text-dna-400 hover:text-white px-2 py-1 rounded border border-bg-border">
            Mark all read
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8"><RefreshCw size={16} className="animate-spin text-dna-400 mx-auto" /></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-8">No notifications match this filter</p>
      ) : (
        <div className="space-y-2">
          {items.map(n => {
            const cfg = notificationTypeConfig(n.type);
            const border = NOTIFICATION_SEVERITY_BORDER[n.severity] ?? '';
            return (
              <div
                key={n.id}
                onClick={() => navigate(resolveNotificationDeepLink(n))}
                className={`group flex items-start gap-3 bg-bg-elevated rounded-lg px-3 py-2.5 border border-bg-border border-l-2 ${border} cursor-pointer hover:bg-bg-base ${n.read ? 'opacity-70' : ''}`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${cfg.color}`}>{cfg.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-medium text-white">{n.title}</p>
                    {n.category && (
                      <span className="text-2xs text-gray-600 capitalize px-1.5 py-0.5 rounded bg-bg-base">{n.category}</span>
                    )}
                    <span className={`text-2xs px-1 py-0.5 rounded capitalize ${
                      n.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                      n.severity === 'warning' ? 'bg-orange-500/20 text-orange-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>{n.severity}</span>
                  </div>
                  <p className="text-2xs text-gray-500 line-clamp-2">{n.body}</p>
                  <p className="text-2xs text-gray-600 mt-1">{formatDistanceToNow(new Date(n.createdAt))} ago · {n.type.replace(/_/g, ' ')}</p>
                </div>
                <div className="flex flex-col items-center gap-1 shrink-0">
                  {!n.read && <span className="w-2 h-2 bg-dna-500 rounded-full" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); archiveItem(n.id); }}
                    className="text-gray-600 hover:text-gray-300 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Archive"
                  >
                    <Archive size={10} />
                  </button>
                </div>
              </div>
            );
          })}
          {hasMore && (
            <button
              disabled={loadingMore}
              onClick={() => load(items.length, true)}
              className="w-full text-2xs text-dna-400 hover:text-white py-2 border border-bg-border rounded-lg"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
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
