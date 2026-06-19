import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, Download, Globe, Users, Clock, RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { formatDistanceToNow } from 'date-fns';

interface ShareLink {
  id: string;
  token: string;
  filename: string;
  createdAt: string;
  isActive: boolean;
  viewCount: number;
  downloadCount: number;
  maxViews: number | null;
  expiresAt: string | null;
  accessLogs: Array<{
    id: string;
    action: string;
    ipAddress: string | null;
    country: string | null;
    device: string | null;
    riskLevel: string | null;
    createdAt: string;
  }>;
}

export function AccessIntelligencePage() {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get(`${API_BASE_URL}/share`)
      .then(r => {
        const data = (r.data as any).links ?? (r.data as any).shareLinks ?? [];
        setLinks(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <RefreshCw size={24} className="animate-spin text-dna-400" />
    </div>
  );

  const activeLinks = links.filter(l => l.isActive);
  const totalViews = links.reduce((s, l) => s + (l.viewCount ?? 0), 0);
  const totalLogs = links.reduce((s, l) => s + (l.accessLogs?.length ?? 0), 0);
  const uniqueCountries = new Set(links.flatMap(l => (l.accessLogs ?? []).map(a => a.country).filter(Boolean)));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield size={20} className="text-dna-400" />
            Access Intelligence
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Click any link to view its separate activity log, viewer tracking, and map</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatCard icon={<Shield size={14} />} label="Total Links" value={links.length} color="text-dna-400" />
        <StatCard icon={<Eye size={14} />} label="Active" value={activeLinks.length} color="text-green-400" />
        <StatCard icon={<Users size={14} />} label="Total Views" value={totalViews} color="text-blue-400" />
        <StatCard icon={<Clock size={14} />} label="Access Events" value={totalLogs} color="text-purple-400" />
        <StatCard icon={<Globe size={14} />} label="Countries" value={uniqueCountries.size} color="text-orange-400" />
      </div>

      {/* Links list */}
      {links.length === 0 ? (
        <div className="card text-center py-16">
          <Shield size={40} className="text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No Smart Links created yet</p>
          <p className="text-2xs text-gray-600 mt-1">Go to Vault Explorer → Share a file to create your first tracked link</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map(link => {
              const logs = link.accessLogs ?? [];
              const uniqueIps = new Set(logs.filter(l => l.action === 'VIEWED').map(l => l.ipAddress).filter(Boolean));
              const hasRisk = logs.some(l => l.riskLevel === 'HIGH' || l.riskLevel === 'CRITICAL');
              const countries = new Set(logs.map(l => l.country).filter(Boolean));
              const lastAccess = logs.length > 0 ? logs[logs.length - 1] : null;

              return (
                <button
                  key={link.id}
                  onClick={() => navigate(`/link/${link.token}`)}
                  className="w-full text-left card hover:border-dna-500/30 transition-all group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full ${link.isActive ? 'bg-green-400' : 'bg-gray-500'}`} />
                        <p className="text-sm font-semibold text-white truncate">{link.filename}</p>
                        {hasRisk && (
                          <span className="flex items-center gap-1 text-2xs text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded">
                            <AlertTriangle size={9} /> Risk
                          </span>
                        )}
                      </div>
                      <p className="text-2xs text-gray-500 font-mono mb-2">
                        Token: {link.token} · Created {formatDistanceToNow(new Date(link.createdAt))} ago
                      </p>

                      {/* Stats row */}
                      <div className="flex items-center gap-4 text-2xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Users size={10} className="text-dna-400" />
                          {uniqueIps.size} viewer{uniqueIps.size !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <Eye size={10} className="text-blue-400" />
                          {link.viewCount} view{link.viewCount !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <Download size={10} className="text-green-400" />
                          {link.downloadCount ?? 0} download{(link.downloadCount ?? 0) !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <Globe size={10} className="text-orange-400" />
                          {countries.size} countr{countries.size !== 1 ? 'ies' : 'y'}
                        </span>
                        {lastAccess && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            Last: {formatDistanceToNow(new Date(lastAccess.createdAt))} ago
                          </span>
                        )}
                      </div>
                    </div>

                    <ChevronRight size={16} className="text-gray-600 group-hover:text-dna-400 transition-colors shrink-0 mt-1" />
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="card-sm text-center">
      <div className={`flex items-center justify-center gap-1 ${color} mb-1`}>{icon}</div>
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-2xs text-gray-500">{label}</p>
    </div>
  );
}
