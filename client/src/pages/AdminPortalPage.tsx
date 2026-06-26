import { useState, useEffect } from 'react';
import { Users, Database, Shield, Activity, Lock, Eye, FileText, BarChart3, AlertTriangle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { formatBytes } from '../hooks/useApi';

type Tab = 'overview' | 'users' | 'vault' | 'activity';

export function AdminPortalPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [vaultFiles, setVaultFiles] = useState<any>(null);
  const [activityData, setActivityData] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadData(); }, [tab]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'overview' || !stats) {
        const r1 = await api.get(`${API_BASE_URL}/admin/stats`);
        setStats(r1.data);
      }
      if (tab === 'users') {
        const r2 = await api.get(`${API_BASE_URL}/admin/users`);
        setUsers((r2.data as any).users);
      }
      if (tab === 'vault') {
        const r3 = await api.get(`${API_BASE_URL}/admin/vault`);
        setVaultFiles(r3.data);
      }
      if (tab === 'activity') {
        const r4 = await api.get(`${API_BASE_URL}/admin/activity`);
        setActivityData(r4.data);
      }
    } catch (err: any) {
      if (err?.response?.status === 403) setError('Admin access required. Your account does not have ADMIN role.');
      else setError('Failed to load admin data');
    }
    setLoading(false);
  };

  const loadUserDetail = async (userId: string) => {
    try {
      const { data } = await api.get(`${API_BASE_URL}/admin/users/${userId}`);
      setSelectedUser(data);
    } catch { /* ignore */ }
  };

  const toggleUserStatus = async (userId: string) => {
    await api.post(`${API_BASE_URL}/admin/users/${userId}/toggle`);
    loadData();
    if (selectedUser?.id === userId) loadUserDetail(userId);
  };

  const changeRole = async (userId: string, role: string) => {
    await api.post(`${API_BASE_URL}/admin/users/${userId}/role`, { role });
    loadData();
    if (selectedUser?.id === userId) loadUserDetail(userId);
  };

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <Shield size={48} className="text-danger mx-auto mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield size={20} className="text-dna-400" /> Admin Portal
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Platform-wide visibility across all users and files</p>
        </div>
        <button onClick={loadData} className="btn btn-secondary btn-sm">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {([
          ['overview', 'Overview', BarChart3],
          ['users', 'Users', Users],
          ['vault', 'Vault Files', Database],
          ['activity', 'Activity', Activity],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => { setTab(id); setSelectedUser(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              tab === id
                ? 'bg-dna-500/15 text-dna-400 border border-dna-500/30'
                : 'bg-bg-elevated text-gray-400 border border-bg-border hover:border-dna-500/20'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12"><RefreshCw size={20} className="animate-spin text-dna-400 mx-auto" /></div>
      ) : (
        <>
          {/* ── OVERVIEW ── */}
          {tab === 'overview' && stats && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'text-dna-400' },
                  { label: 'Active Users', value: stats.activeUsers, icon: CheckCircle, color: 'text-success' },
                  { label: 'Face Auth Users', value: stats.faceUsers, icon: Eye, color: 'text-info' },
                  { label: 'Logins (24h)', value: stats.recentLogins, icon: Activity, color: 'text-warning' },
                  { label: 'DNA Records', value: stats.totalDna, icon: FileText, color: 'text-violet-400' },
                  { label: 'Vault Files', value: stats.totalVault, icon: Lock, color: 'text-success' },
                  { label: 'Share Links', value: stats.totalLinks, icon: Eye, color: 'text-info' },
                  { label: 'Total Views', value: stats.totalViews, icon: BarChart3, color: 'text-amber-400' },
                  { label: 'Certificates', value: stats.totalCerts, icon: Shield, color: 'text-emerald-400' },
                  { label: 'Notifications', value: stats.totalNotifs, icon: AlertTriangle, color: 'text-red-400' },
                  { label: 'Total Logins', value: stats.totalLogins, icon: Activity, color: 'text-dna-400' },
                ].map((s, i) => (
                  <div key={i} className="card-sm text-center">
                    <s.icon size={18} className={`${s.color} mx-auto mb-2`} />
                    <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                    <p className="text-2xs text-gray-500 mt-1 font-semibold uppercase tracking-wider">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── USERS ── */}
          {tab === 'users' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                <div className="sticky top-0 bg-bg-card p-3 border-b border-bg-border">
                  <p className="text-sm font-bold text-white">{users.length} Users</p>
                </div>
                {users.map(u => (
                  <div
                    key={u.id}
                    onClick={() => loadUserDetail(u.id)}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-bg-border/50 hover:bg-bg-elevated transition ${
                      selectedUser?.id === u.id ? 'bg-dna-500/10' : ''
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                      u.faceRegistered ? 'bg-gradient-to-br from-dna-500 to-indigo-600' : 'bg-gray-600'
                    }`}>
                      {u.shortId?.slice(-2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white">{u.shortId}</p>
                      <p className="text-2xs text-gray-500 truncate">{u.email || u.fullName} · {u._count.dnaRecords} files</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {u.faceRegistered && <span className="text-2xs bg-dna-500/15 text-dna-400 px-1.5 py-0.5 rounded font-bold">Face</span>}
                      <span className={`text-2xs px-1.5 py-0.5 rounded font-bold ${
                        u.role === 'ADMIN' ? 'bg-red-500/15 text-red-400' :
                        u.role === 'ANALYST' ? 'bg-blue-500/15 text-blue-400' :
                        'bg-gray-500/15 text-gray-400'
                      }`}>{u.role}</span>
                      {!u.isActive && <XCircle size={12} className="text-danger" />}
                    </div>
                  </div>
                ))}
              </div>

              {/* User Detail Panel */}
              <div>
                {selectedUser ? (
                  <div className="card space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">{selectedUser.shortId}</p>
                        <p className="text-2xs text-gray-500">{selectedUser.fullName} · {selectedUser.email || 'No email'}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => toggleUserStatus(selectedUser.id)} className={`btn btn-sm ${selectedUser.isActive ? 'btn-danger' : 'btn-primary'}`}>
                          {selectedUser.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <select
                          value={selectedUser.role}
                          onChange={e => changeRole(selectedUser.id, e.target.value)}
                          className="bg-bg-elevated border border-bg-border rounded-lg px-2 py-1 text-xs text-white"
                        >
                          <option value="USER">USER</option>
                          <option value="ANALYST">ANALYST</option>
                          <option value="AUDITOR">AUDITOR</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-bg-elevated rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-dna-400">{selectedUser.dnaRecords?.length ?? 0}</p>
                        <p className="text-2xs text-gray-500">DNA</p>
                      </div>
                      <div className="bg-bg-elevated rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-success">{selectedUser.shareLinks?.length ?? 0}</p>
                        <p className="text-2xs text-gray-500">Links</p>
                      </div>
                      <div className="bg-bg-elevated rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-info">{selectedUser.loginHistory?.length ?? 0}</p>
                        <p className="text-2xs text-gray-500">Logins</p>
                      </div>
                    </div>

                    {/* Files */}
                    {selectedUser.dnaRecords?.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-gray-400 mb-2">Vault Files</p>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {selectedUser.dnaRecords.map((d: any) => (
                            <div key={d.id} className="flex items-center gap-2 bg-bg-elevated rounded-lg px-3 py-2">
                              <Lock size={12} className="text-success" />
                              <span className="text-xs text-white truncate flex-1">{d.imageFilename}</span>
                              <span className="text-2xs text-gray-500 mono">{formatBytes(d.imageSizeBytes)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Login History */}
                    {selectedUser.loginHistory?.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-gray-400 mb-2">Login History</p>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {selectedUser.loginHistory.slice(0, 10).map((l: any) => (
                            <div key={l.id} className="flex items-center gap-2 bg-bg-elevated rounded-lg px-3 py-2">
                              {l.success ? <CheckCircle size={12} className="text-success" /> : <XCircle size={12} className="text-danger" />}
                              <span className="text-xs text-white flex-1">{l.method}</span>
                              <span className="text-2xs text-gray-500">{l.ip}</span>
                              <span className="text-2xs text-gray-600">{new Date(l.createdAt).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="card text-center py-12">
                    <Users size={32} className="text-gray-600 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">Select a user to view details</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── VAULT FILES ── */}
          {tab === 'vault' && vaultFiles && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="card-sm text-center">
                  <p className="text-xl font-black text-dna-400">{vaultFiles.total}</p>
                  <p className="text-2xs text-gray-500 font-bold uppercase">Total Files</p>
                </div>
                <div className="card-sm text-center">
                  <p className="text-xl font-black text-success">{formatBytes(vaultFiles.totalSize)}</p>
                  <p className="text-2xs text-gray-500 font-bold uppercase">Original Size</p>
                </div>
                <div className="card-sm text-center">
                  <p className="text-xl font-black text-info">{formatBytes(vaultFiles.totalEncrypted)}</p>
                  <p className="text-2xs text-gray-500 font-bold uppercase">Encrypted Size</p>
                </div>
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-bg-border text-gray-500 text-left">
                      <th className="px-4 py-3 font-semibold">File</th>
                      <th className="px-4 py-3 font-semibold">Owner</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Size</th>
                      <th className="px-4 py-3 font-semibold">Encryption</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vaultFiles.files.map((f: any) => (
                      <tr key={f.id} className="border-b border-bg-border/50 hover:bg-bg-elevated">
                        <td className="px-4 py-3 text-white font-medium truncate max-w-[200px]">{f.originalFileName}</td>
                        <td className="px-4 py-3 text-dna-400 mono">{f.dnaRecord?.ownerUser?.shortId ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-400">{f.dnaRecord?.fileType ?? f.originalMimeType}</td>
                        <td className="px-4 py-3 text-gray-400 mono">{formatBytes(f.originalSizeBytes)}</td>
                        <td className="px-4 py-3"><span className="text-2xs bg-success/15 text-success px-2 py-0.5 rounded-full font-bold">{f.encryptionAlgorithm}</span></td>
                        <td className="px-4 py-3 text-gray-500">{new Date(f.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── ACTIVITY ── */}
          {tab === 'activity' && activityData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-bold text-white mb-3">Recent Logins</p>
                <div className="card space-y-0 max-h-[400px] overflow-y-auto">
                  {activityData.logins.map((l: any) => (
                    <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-bg-border/50">
                      {l.success ? <CheckCircle size={14} className="text-success" /> : <XCircle size={14} className="text-danger" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white font-semibold">{l.user?.shortId ?? '—'}</p>
                        <p className="text-2xs text-gray-500">{l.method} · {l.ip}</p>
                      </div>
                      <span className="text-2xs text-gray-600">{new Date(l.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-bold text-white mb-3">File Access Logs</p>
                <div className="card space-y-0 max-h-[400px] overflow-y-auto">
                  {activityData.accessLogs.map((l: any) => (
                    <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-bg-border/50">
                      <Eye size={14} className="text-info" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white font-semibold truncate">{l.shareLink?.filename ?? '—'}</p>
                        <p className="text-2xs text-gray-500">{l.action} · {l.city}, {l.country} · {l.device}</p>
                      </div>
                      <span className="text-2xs text-gray-600">{new Date(l.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
