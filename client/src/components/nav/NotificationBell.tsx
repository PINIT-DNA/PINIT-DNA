import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Eye, GitBranch, Award, Radio, CheckCheck, Trash2, X,
  AlertTriangle, ExternalLink, Dna, Archive,
} from 'lucide-react';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  createdAt: string;
  type: string;
  title: string;
  body: string;
  severity: string;
  read: boolean;
  linkToken?: string;
  fileName?: string;
  riskLevel?: string;
  country?: string;
  device?: string;
  ip?: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  LINK_VIEWED:       { icon: <Eye size={13} />,        color: 'text-blue-400 bg-blue-500/20' },
  RISK_ALERT:        { icon: <AlertTriangle size={13} />, color: 'text-red-400 bg-red-500/20' },
  FORWARD_DETECTED:  { icon: <GitBranch size={13} />,  color: 'text-orange-400 bg-orange-500/20' },
  CERT_GENERATED:    { icon: <Award size={13} />,      color: 'text-purple-400 bg-purple-500/20' },
  MONITORING_MATCH:  { icon: <Radio size={13} />,      color: 'text-yellow-400 bg-yellow-500/20' },
  DNA_GENERATED:     { icon: <Dna size={13} />,        color: 'text-dna-400 bg-dna-500/20' },
  VAULT_STORED:      { icon: <Archive size={13} />,    color: 'text-green-400 bg-green-500/20' },
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-red-500',
  warning:  'border-l-orange-400',
  info:     'border-l-transparent',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const fetchNotifs = useCallback(() => {
    api.get(`${API_BASE_URL}/notifications?limit=20`).then(r => {
      const data = r.data as { notifications?: Notification[]; unreadCount?: number };
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    }).catch((err: unknown) => {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'BACKEND_OFFLINE') return;
    });
  }, []);

  // Poll every 30 seconds
  useEffect(() => {
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifs]);

  // Fetch when opened
  useEffect(() => {
    if (open) fetchNotifs();
  }, [open, fetchNotifs]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markAllRead = async () => {
    await api.put(`${API_BASE_URL}/notifications/read-all`);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const markRead = async (id: string) => {
    await api.put(`${API_BASE_URL}/notifications/${id}/read`);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const deleteNotif = async (id: string) => {
    await api.delete(`${API_BASE_URL}/notifications/${id}`);
    setNotifications(prev => prev.filter(n => n.id !== id));
    setUnreadCount(prev => {
      const was = notifications.find(n => n.id === id);
      return was && !was.read ? Math.max(0, prev - 1) : prev;
    });
  };

  const handleClick = (n: Notification) => {
    markRead(n.id);
    if (n.linkToken) {
      setOpen(false);
      navigate(`/timeline`);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="btn-icon btn-ghost relative"
      >
        <Bell size={16} className={unreadCount > 0 ? 'text-dna-400' : 'text-gray-400'} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-96 bg-bg-card border border-bg-border rounded-xl shadow-2xl z-[9999] overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-dna-400" />
              <h3 className="text-sm font-semibold text-white">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-2xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-medium">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-2xs text-dna-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-elevated transition-colors">
                  <CheckCheck size={10} /> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white p-1">
                <X size={12} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <Bell size={24} className="text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No notifications yet</p>
                <p className="text-2xs text-gray-600 mt-1">You'll see alerts when someone views your shared files</p>
              </div>
            ) : (
              notifications.map(n => {
                const cfg = TYPE_CONFIG[n.type] ?? { icon: <Bell size={13} />, color: 'text-gray-400 bg-gray-500/20' };
                const borderColor = SEVERITY_BORDER[n.severity] ?? 'border-l-transparent';
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-bg-border border-l-2 cursor-pointer transition-colors ${borderColor} ${
                      n.read ? 'opacity-60 hover:opacity-80' : 'hover:bg-bg-elevated'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${cfg.color}`}>
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs font-medium ${n.read ? 'text-gray-500' : 'text-white'}`}>{n.title}</p>
                        {!n.read && <span className="w-2 h-2 bg-dna-500 rounded-full shrink-0 mt-1" />}
                      </div>
                      <p className="text-2xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-2xs text-gray-600">{formatDistanceToNow(new Date(n.createdAt))} ago</span>
                        {n.riskLevel && n.riskLevel !== 'LOW' && (
                          <span className={`text-2xs px-1 py-0.5 rounded ${
                            n.riskLevel === 'CRITICAL' ? 'bg-red-500/20 text-red-400' :
                            n.riskLevel === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>{n.riskLevel}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNotif(n.id); }}
                      className="text-gray-600 hover:text-red-400 p-1 shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-bg-border text-center">
              <button
                onClick={() => { setOpen(false); navigate('/profile?tab=activity'); }}
                className="text-2xs text-dna-400 hover:text-white flex items-center gap-1 mx-auto transition-colors"
              >
                <ExternalLink size={10} /> View all activity
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
