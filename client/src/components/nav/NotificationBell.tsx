import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Trash2, X, ExternalLink, BellOff } from 'lucide-react';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { getAccessToken } from '../../lib/auth';
import { formatDistanceToNow } from 'date-fns';
import {
  type NotificationItem,
  notificationTypeConfig,
  NOTIFICATION_SEVERITY_BORDER,
  resolveNotificationDeepLink,
} from '../../lib/notification-config';

/**
 * Split rows into Today and Earlier.
 *
 * Two buckets rather than a full date breakdown: the question a person opens
 * the bell to answer is "is there anything new", and more headings than that
 * just adds scrolling.
 */
function groupByDay(rows: NotificationItem[]): [string, NotificationItem[]][] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const today: NotificationItem[] = [];
  const earlier: NotificationItem[] = [];
  for (const n of rows) {
    (new Date(n.createdAt) >= startOfToday ? today : earlier).push(n);
  }

  const out: [string, NotificationItem[]][] = [];
  if (today.length) out.push(['Today', today]);
  if (earlier.length) out.push(['Earlier', earlier]);
  return out;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const fetchNotifs = useCallback(() => {
    // view=bell returns NOTIFICATION and ALERT only. Activity belongs in the
    // dashboard timeline and must never raise a badge here.
    api.get(`${API_BASE_URL}/notifications?limit=30&view=bell`).then(r => {
      const data = r.data as { notifications?: NotificationItem[]; unreadCount?: number };
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    }).catch((err: unknown) => {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'BACKEND_OFFLINE') return;
    });
  }, []);

  useEffect(() => {
    fetchNotifs();
    const token = getAccessToken();
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connectSse = () => {
      if (!token || closed) return;
      const url = `${API_BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { unreadCount?: number };
          if (typeof data.unreadCount === 'number') {
            setUnreadCount(data.unreadCount);
            fetchNotifs();
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (!closed) {
          reconnectTimer = setTimeout(connectSse, 5000);
        }
      };
    };

    connectSse();
    const interval = setInterval(fetchNotifs, 60000);

    return () => {
      closed = true;
      clearInterval(interval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [fetchNotifs]);

  useEffect(() => {
    if (open) fetchNotifs();
  }, [open, fetchNotifs]);

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

  const clearInbox = async () => {
    await api.put(`${API_BASE_URL}/notifications/clear-inbox`);
    setNotifications([]);
    setUnreadCount(0);
  };

  const markRead = async (id: string) => {
    await api.put(`${API_BASE_URL}/notifications/${id}/read`);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const deleteNotif = async (id: string) => {
    const was = notifications.find(n => n.id === id);
    await api.delete(`${API_BASE_URL}/notifications/${id}`);
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (was && !was.read) setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const handleClick = (n: NotificationItem) => {
    markRead(n.id);
    setOpen(false);
    navigate(resolveNotificationDeepLink(n));
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="btn-icon btn-ghost relative"
        aria-label="Notifications"
      >
        <Bell size={16} className={unreadCount > 0 ? 'text-dna-400' : 'text-gray-400'} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="dropdown-backdrop"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <div className="dropdown-panel w-full sm:w-96 flex flex-col">
          <div className="px-4 py-3 border-b border-bg-border shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Bell size={14} className="text-dna-400 shrink-0" />
                <h3 className="text-sm font-semibold text-white">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="text-2xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-500 hover:text-white p-1 shrink-0" aria-label="Close notifications">
                <X size={12} />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="text-2xs text-dna-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-elevated transition-colors"
                >
                  <CheckCheck size={10} /> Mark all as read
                </button>
              )}
              <button
                type="button"
                onClick={() => void clearInbox()}
                className="text-2xs text-gray-300 hover:text-white flex items-center gap-1 px-2 py-1 rounded border border-bg-border hover:bg-bg-elevated transition-colors"
              >
                <BellOff size={10} /> Clear all
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <Bell size={24} className="text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-500">Nothing needs you right now</p>
                <p className="text-2xs text-gray-600 mt-1 max-w-[13rem] mx-auto">
                  You'll see something here when a person acts on work you're
                  responsible for. Ordinary activity stays on the dashboard.
                </p>
              </div>
            ) : (
              groupByDay(notifications).map(([heading, rows]) => (
                <div key={heading}>
                  <p className="px-4 py-1.5 text-2xs font-semibold text-gray-500 bg-bg-elevated/60 sticky top-0">
                    {heading}
                  </p>
                  {rows.map(n => {
                const cfg = notificationTypeConfig(n.type);
                const borderColor = NOTIFICATION_SEVERITY_BORDER[n.severity] ?? 'border-l-transparent';
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`group flex items-start gap-3 px-4 py-3 border-b border-bg-border border-l-2 cursor-pointer transition-colors ${borderColor} ${
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
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-2xs text-gray-600">{formatDistanceToNow(new Date(n.createdAt))} ago</span>
                        {(n.aggregateCount ?? 1) > 1 && (
                          <span className="text-2xs bg-dna-500/15 text-dna-400 px-1.5 py-0.5 rounded-full">
                            ×{n.aggregateCount}
                          </span>
                        )}
                        {n.category && (
                          <span className="text-2xs text-gray-600 capitalize">{n.category}</span>
                        )}
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
                      className="text-gray-600 hover:text-red-400 p-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                );
                  })}
                </div>
              ))
            )}
          </div>

            <div className="px-4 py-2 border-t border-bg-border shrink-0 flex items-center justify-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => void clearInbox()}
                className="text-2xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
              >
                <BellOff size={10} /> Clear all
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/profile?tab=notifications'); }}
                className="text-2xs text-dna-400 hover:text-white flex items-center gap-1 transition-colors"
              >
                <ExternalLink size={10} /> View notification history
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
