import { useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { Shield, AlertTriangle, Users, TrendingUp, Eye, Globe, Cpu, Activity } from 'lucide-react';

interface Recipient {
  id: string;
  label: string;
  recipientCode: string;
  trustScore: number;
  totalAccessCount: number;
  knownCountries: string[];
  knownDevices: string[];
  lastAccessAt: string | null;
  _count: { shareLinks: number };
}

interface ShareLink {
  id: string;
  token: string;
  filename: string;
  forwardStatus: string;
  forwardRiskScore: number;
  viewCount: number;
  createdAt: string;
  recipientLabel: string | null;
}

function TrustBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-400 bg-green-400/10' :
                score >= 50 ? 'text-yellow-400 bg-yellow-400/10' :
                              'text-red-400 bg-red-400/10';
  return <span className={`px-2 py-0.5 rounded text-xs font-bold ${color}`}>{score}</span>;
}

function RiskBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    CLEAN: 'text-green-400 bg-green-400/10',
    SUSPECTED: 'text-yellow-400 bg-yellow-400/10',
    CONFIRMED: 'text-red-400 bg-red-400/10',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-bold ${map[status] ?? 'text-gray-400 bg-gray-400/10'}`}>{status}</span>;
}

export function ForensicDashboardPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'recipients' | 'links'>('recipients');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [recRes, linksRes] = await Promise.all([
        api.get('/recipients'),
        api.get('/share'),
      ]);
      setRecipients(recRes.data.recipients ?? []);
      const allLinks: ShareLink[] = linksRes.data.links ?? [];
      setLinks(allLinks.filter(l => l.forwardStatus !== 'CLEAN' || l.forwardRiskScore > 0));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newLabel.trim()) return;
    setCreating(true);
    try {
      await api.post('/recipients', { label: newLabel.trim() });
      setNewLabel('');
      await loadAll();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this recipient? All linked share links will lose their recipient binding.')) return;
    await api.delete(`/recipients/${id}`);
    await loadAll();
  }

  const highRiskLinks = links.filter(l => l.forwardStatus === 'CONFIRMED' || l.forwardRiskScore >= 70);
  const suspectedLinks = links.filter(l => l.forwardStatus === 'SUSPECTED');
  const lowTrustRecipients = recipients.filter(r => r.trustScore < 60);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-7 h-7 text-purple-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Forensic Intelligence Dashboard</h1>
          <p className="text-sm text-gray-400">Recipient trust management · Forward detection · Risk overview</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#1a1d2e] rounded-xl p-4 border border-purple-500/20">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-gray-400">Total Recipients</span>
          </div>
          <div className="text-2xl font-bold text-white">{recipients.length}</div>
        </div>
        <div className="bg-[#1a1d2e] rounded-xl p-4 border border-red-500/20">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-gray-400">High Risk Links</span>
          </div>
          <div className="text-2xl font-bold text-red-400">{highRiskLinks.length}</div>
        </div>
        <div className="bg-[#1a1d2e] rounded-xl p-4 border border-yellow-500/20">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-yellow-400" />
            <span className="text-xs text-gray-400">Suspected Forwards</span>
          </div>
          <div className="text-2xl font-bold text-yellow-400">{suspectedLinks.length}</div>
        </div>
        <div className="bg-[#1a1d2e] rounded-xl p-4 border border-orange-500/20">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-orange-400" />
            <span className="text-xs text-gray-400">Low Trust Recipients</span>
          </div>
          <div className="text-2xl font-bold text-orange-400">{lowTrustRecipients.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10">
        {(['recipients', 'links'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'recipients' ? 'Recipients' : 'Risk Links'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">Loading...</div>
      ) : activeTab === 'recipients' ? (
        <div className="space-y-4">
          {/* Create new recipient */}
          <div className="flex gap-3">
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="New recipient label (e.g. John Smith - Legal)"
              className="flex-1 bg-[#1a1d2e] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newLabel.trim()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {creating ? 'Creating...' : '+ Add Recipient'}
            </button>
          </div>

          {recipients.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No recipients yet. Add one above to start forensic tracking.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recipients.map(r => (
                <div key={r.id} className="bg-[#1a1d2e] rounded-xl p-4 border border-white/5 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white">{r.label}</span>
                      <TrustBadge score={r.trustScore} />
                      <span className="text-xs text-gray-500 font-mono">{r.recipientCode}</span>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{r.totalAccessCount} accesses</span>
                      <span className="flex items-center gap-1"><Activity className="w-3 h-3" />{r._count.shareLinks} links</span>
                      <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{r.knownCountries.length > 0 ? r.knownCountries.join(', ') : 'No countries yet'}</span>
                      <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />{r.knownDevices.length} devices</span>
                    </div>
                    {r.lastAccessAt && (
                      <div className="text-xs text-gray-500 mt-1">
                        Last access: {new Date(r.lastAccessAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleDelete(r.id)} className="text-gray-500 hover:text-red-400 text-xs transition-colors">Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {links.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No flagged links. All your share links are clean.</p>
            </div>
          ) : (
            links.map(l => (
              <div key={l.id} className="bg-[#1a1d2e] rounded-xl p-4 border border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-white text-sm truncate">{l.filename}</span>
                  <RiskBadge status={l.forwardStatus} />
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                  <span>Risk Score: <span className="text-white font-bold">{l.forwardRiskScore}</span></span>
                  <span>Views: {l.viewCount}</span>
                  {l.recipientLabel && <span>Recipient: {l.recipientLabel}</span>}
                  <span className="font-mono text-gray-500">/s/{l.token}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">{new Date(l.createdAt).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
