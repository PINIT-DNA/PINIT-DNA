import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Plus, Send, CheckCircle2, Clock, ShieldAlert, Inbox } from 'lucide-react';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { LightStatCard } from '../components/LightStatCard';
import {
  fetchSupportTickets, fetchSupportTicketDetail, createSupportTicket,
  addSupportTicketMessage, resolveSupportTicket,
} from '../api/super-admin.api';
import type { SupportTicketRow, SupportTicketMessageRow } from '../api/super-admin.api';

const inputClass = 'w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className={`bg-white border border-gray-200 rounded-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[85vh] overflow-hidden flex flex-col shadow-xl`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm">Close</button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [shortId, setShortId] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [priority, setPriority] = useState('NORMAL');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!shortId.trim() || !subject.trim() || !description.trim()) {
      toast.error('User, subject and description are required');
      return;
    }
    setSubmitting(true);
    try {
      await createSupportTicket({ shortId: shortId.trim(), subject, category, priority, description });
      toast.success('Ticket opened');
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to open ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Open Support Ticket" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">User PINIT ID</label>
          <input value={shortId} onChange={(e) => setShortId(e.target.value)} placeholder="PINIT-XXXXXXXX" className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="GENERAL">General</option>
              <option value="BILLING">Billing</option>
              <option value="TECHNICAL">Technical</option>
              <option value="DISPUTE">Dispute</option>
              <option value="ABUSE">Abuse Report</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What the user reported, and how it came in" className={inputClass} />
        </div>
        <button type="button" onClick={submit} disabled={submitting} className="w-full px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
          {submitting ? 'Opening…' : 'Open Ticket'}
        </button>
      </div>
    </Modal>
  );
}

function TicketDetailModal({ ticketId, onClose, onChanged }: { ticketId: string; onClose: () => void; onChanged: () => void }) {
  const [ticket, setTicket] = useState<(SupportTicketRow & { messages: SupportTicketMessageRow[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetchSupportTicketDetail(ticketId).then((d) => setTicket(d.ticket)).finally(() => setLoading(false));
  };

  useEffect(load, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await addSupportTicketMessage(ticketId, { body: reply, isInternal: internal });
      setReply('');
      toast.success('Message added');
      load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    setBusy(true);
    try {
      await resolveSupportTicket(ticketId, { resolutionNote: resolutionNote || undefined });
      toast.success('Ticket resolved');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to resolve');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={ticket ? `${ticket.subject}` : 'Ticket'} onClose={onClose} wide>
      {loading || !ticket ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-gray-500">User</span><p className="font-mono text-gray-900">{ticket.user?.shortId}</p></div>
            <div><span className="text-gray-500">Status</span><p><LightStatusBadge value={ticket.status} /></p></div>
            <div><span className="text-gray-500">Category</span><p className="text-gray-900">{ticket.category}</p></div>
            <div><span className="text-gray-500">Priority</span><p className="text-gray-900">{ticket.priority}</p></div>
          </div>
          <div><span className="text-gray-500">Description</span><p className="text-gray-900 mt-0.5">{ticket.description}</p></div>

          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">Thread ({ticket.messages.length})</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {ticket.messages.length === 0 && <p className="text-xs text-gray-400">No messages yet</p>}
              {ticket.messages.map((m) => (
                <div key={m.id} className={`border rounded-lg p-2.5 text-xs ${m.isInternal ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-gray-700">{m.authorLabel}{m.isInternal ? ' · internal note' : ''}</span>
                    <span className="text-gray-400">{format(new Date(m.createdAt), 'MMM d HH:mm')}</span>
                  </div>
                  <p className="text-gray-900">{m.body}</p>
                </div>
              ))}
            </div>
          </div>

          {ticket.status !== 'RESOLVED' && (
            <div className="space-y-2 border-t border-gray-200 pt-3">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Reply to the user, or leave an internal note" className={inputClass} />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400" />
                  Internal note (not shown to user)
                </label>
                <button type="button" onClick={sendReply} disabled={busy || !reply.trim()} className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                  <Send size={12} /> Send
                </button>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <input value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} placeholder="Resolution note (optional)" className={`${inputClass} flex-1`} />
                <button type="button" onClick={resolve} disabled={busy} className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap">
                  <CheckCircle2 size={12} /> Resolve
                </button>
              </div>
            </div>
          )}
          {ticket.status === 'RESOLVED' && ticket.resolutionNote && (
            <div className="border-t border-gray-200 pt-3">
              <span className="text-gray-500 text-xs">Resolution</span>
              <p className="text-gray-900">{ticket.resolutionNote}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function SupportDisputesPage() {
  const [data, setData] = useState<{ tickets: SupportTicketRow[]; openCount: number; disputeCount: number; resolvedCount: number } | null>(null);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchSupportTickets({ status: status || undefined, category: category || undefined })
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(load, [status, category]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <LightStatCard label="Open" value={data?.openCount ?? 0} icon={Inbox} />
        <LightStatCard label="Active Disputes" value={data?.disputeCount ?? 0} icon={ShieldAlert} />
        <LightStatCard label="Resolved" value={data?.resolvedCount ?? 0} icon={Clock} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">All categories</option>
          <option value="GENERAL">General</option>
          <option value="BILLING">Billing</option>
          <option value="TECHNICAL">Technical</option>
          <option value="DISPUTE">Dispute</option>
          <option value="ABUSE">Abuse Report</option>
        </select>
        <button type="button" onClick={() => setNewOpen(true)} className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1.5 ml-auto">
          <Plus size={14} /> Open Ticket
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : (
        <LightDataTable
          rows={data?.tickets ?? []}
          keyField="id"
          emptyMessage="No support tickets yet"
          onRowClick={(r: SupportTicketRow) => setOpenTicketId(r.id)}
          columns={[
            { key: 'user', header: 'User', render: (r: SupportTicketRow) => <span className="font-mono text-xs">{r.user?.shortId ?? '—'}</span> },
            { key: 'subject', header: 'Subject', render: (r: SupportTicketRow) => <span className="max-w-[240px] truncate block">{r.subject}</span> },
            { key: 'category', header: 'Category', render: (r: SupportTicketRow) => r.category },
            { key: 'priority', header: 'Priority', render: (r: SupportTicketRow) => r.priority },
            { key: 'status', header: 'Status', render: (r: SupportTicketRow) => <LightStatusBadge value={r.status} /> },
            { key: 'messages', header: 'Messages', render: (r: SupportTicketRow) => r.messageCount },
            { key: 'created', header: 'Opened', render: (r: SupportTicketRow) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {newOpen && <NewTicketModal onClose={() => setNewOpen(false)} onCreated={load} />}
      {openTicketId && <TicketDetailModal ticketId={openTicketId} onClose={() => setOpenTicketId(null)} onChanged={load} />}
    </div>
  );
}
