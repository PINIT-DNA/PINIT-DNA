import { api } from '../services/dashboard.api';
/**
 * Owner inbox: unmask requests + share viewer messages.
 * Route: /unmask-requests
 */

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Shield, RefreshCw, CheckCircle2, XCircle, Clock, Eye, AlertTriangle, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApi } from '../hooks/useApi';
import { API_BASE_URL } from '../config/api.config';
import { SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

interface UnmaskRequest {
  id:            string;
  createdAt:     string;
  reviewedAt:    string | null;
  shareToken:    string;
  recipientName: string | null;
  sessionId:     string | null;
  ipAddress:     string | null;
  device:        string | null;
  browser:       string | null;
  os:            string | null;
  status:        'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote:    string | null;
  shareLink:     { filename: string; token: string };
}

interface ShareMessage {
  id: string;
  createdAt: string;
  senderName: string | null;
  body: string;
  status: string;
  ownerReply: string | null;
  shareLink: { filename: string; token: string };
}

async function fetchRequests(): Promise<UnmaskRequest[]> {
  const { data } = await api.get(`${API_BASE_URL}/share/unmask-requests`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any).requests ?? [];
}

export function UnmaskRequestsPage() {
  const { data: requests, loading, error, refetch } = useApi(fetchRequests);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [messages, setMessages] = useState<ShareMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);

  const loadMessages = async () => {
    setMessagesLoading(true);
    try {
      const { data } = await api.get(`${API_BASE_URL}/share/messages`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMessages((data as any).messages ?? []);
    } catch {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  useEffect(() => {
    void loadMessages();
  }, []);

  const review = async (id: string, action: 'approve' | 'reject') => {
    setReviewing(id);
    try {
      await api.post(`${API_BASE_URL}/share/unmask-requests/${id}/review`, { action });
      refetch();
    } finally {
      setReviewing(null);
    }
  };

  const replyToMessage = async (id: string) => {
    const reply = (replyDrafts[id] ?? '').trim();
    if (!reply) return;
    setReplyingId(id);
    try {
      await api.post(`${API_BASE_URL}/share/messages/${id}/reply`, { reply });
      toast.success('Reply sent');
      setReplyDrafts((prev) => ({ ...prev, [id]: '' }));
      await loadMessages();
    } catch {
      toast.error('Could not send reply');
    } finally {
      setReplyingId(null);
    }
  };

  const pending  = (requests ?? []).filter(r => r.status === 'PENDING');
  const reviewed = (requests ?? []).filter(r => r.status !== 'PENDING');

  const statusBadge = (s: string) => {
    if (s === 'PENDING')  return <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 rounded px-2 py-0.5">Pending</span>;
    if (s === 'APPROVED') return <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/30 rounded px-2 py-0.5">Approved</span>;
    if (s === 'REPLIED') return <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/30 rounded px-2 py-0.5">Replied</span>;
    return                       <span className="text-xs bg-red-500/15 text-red-400 border border-red-500/30 rounded px-2 py-0.5">Rejected</span>;
  };

  return (
    <div className="page-shell space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield size={20} className="text-purple-400" />
            Share Responses
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Unmask requests and messages from people who opened your shared files
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && pending.length > 0 && (
            <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 rounded-full px-3 py-1 font-semibold animate-pulse">
              {pending.length} pending
            </span>
          )}
          <button
            onClick={() => { refetch(); void loadMessages(); }}
            disabled={loading || messagesLoading}
            className="btn btn-secondary btn-sm"
          >
            <RefreshCw size={13} className={loading || messagesLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-dna-300 flex items-center gap-2">
          <MessageSquare size={14} /> Messages from viewers
        </h2>
        {messagesLoading ? (
          <SkeletonCard />
        ) : messages.length === 0 ? (
          <div className="card p-4 text-sm text-gray-500">No viewer messages yet.</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-white">{m.senderName || 'Anonymous viewer'}</p>
                  <p className="text-xs text-gray-500">{m.shareLink.filename} · {format(new Date(m.createdAt), 'MMM d, HH:mm')}</p>
                </div>
                {statusBadge(m.status)}
              </div>
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{m.body}</p>
              {m.ownerReply ? (
                <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                  Your reply: {m.ownerReply}
                </p>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={replyDrafts[m.id] ?? ''}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    placeholder="Write a reply…"
                    className="flex-1 rounded-lg bg-bg-elevated border border-bg-border px-3 py-2 text-sm text-white"
                  />
                  <button
                    type="button"
                    disabled={replyingId === m.id || !(replyDrafts[m.id] ?? '').trim()}
                    onClick={() => void replyToMessage(m.id)}
                    className="btn btn-secondary btn-sm disabled:opacity-50"
                  >
                    Reply
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : error ? (
        <div className="card p-6 text-center">
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm">Failed to load requests</p>
          <button onClick={refetch} className="btn btn-secondary btn-sm mt-3">Retry</button>
        </div>
      ) : !requests || requests.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No Unmask Requests"
          description="No recipients have requested unmasked access yet." />
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
                <Clock size={14} /> Pending Unmask Review ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map(r => (
                  <div key={r.id} className="card border border-yellow-500/30 bg-yellow-500/5 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {r.recipientName ?? 'Anonymous Recipient'}
                        </p>
                        <p className="text-xs text-purple-400 mono mt-0.5">{r.shareLink.filename}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {r.ipAddress && <span className="tag">IP: {r.ipAddress}</span>}
                          {r.device    && <span className="tag">{r.device}</span>}
                          {r.browser   && <span className="tag">{r.browser}</span>}
                          {r.os        && <span className="tag">{r.os}</span>}
                          <span className="tag">{format(new Date(r.createdAt), 'MMM d, HH:mm')}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => review(r.id, 'approve')}
                          disabled={reviewing === r.id}
                          className="btn btn-sm bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30"
                        >
                          {reviewing === r.id ? <div className="w-3 h-3 border border-green-400 border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 size={13} />}
                          Approve
                        </button>
                        <button
                          onClick={() => review(r.id, 'reject')}
                          disabled={reviewing === r.id}
                          className="btn btn-sm bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30"
                        >
                          <XCircle size={13} /> Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {reviewed.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                <Eye size={14} /> Unmask Review History ({reviewed.length})
              </h2>
              <div className="space-y-2">
                {reviewed.map(r => (
                  <div key={r.id} className="card p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm text-white">{r.recipientName ?? 'Anonymous'}</p>
                      <p className="text-xs text-gray-500">{r.shareLink.filename} · {format(new Date(r.createdAt), 'MMM d, HH:mm')}</p>
                    </div>
                    {statusBadge(r.status)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
