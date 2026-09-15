import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Plus, Check, X } from 'lucide-react';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { LightStatCard } from '../components/LightStatCard';
import {
  fetchVerificationRequests, createVerificationRequest, reviewVerificationRequest,
} from '../api/super-admin.api';
import type { VerificationRequestRow } from '../api/super-admin.api';
import { Clock, ShieldCheck, ShieldX } from 'lucide-react';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white border border-gray-200 rounded-xl w-full max-w-md overflow-hidden flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm">Close</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400';

function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [shortId, setShortId] = useState('');
  const [requestType, setRequestType] = useState('IDENTITY');
  const [documentType, setDocumentType] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!shortId.trim()) {
      toast.error('User PINIT ID is required');
      return;
    }
    setSubmitting(true);
    try {
      await createVerificationRequest({ shortId: shortId.trim(), requestType, documentType: documentType || undefined, submittedNote: note || undefined });
      toast.success('Verification request logged');
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to log request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Log Verification Request" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">User PINIT ID</label>
          <input value={shortId} onChange={(e) => setShortId(e.target.value)} placeholder="PINIT-XXXXXXXX" className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Request Type</label>
          <select value={requestType} onChange={(e) => setRequestType(e.target.value)} className={inputClass}>
            <option value="IDENTITY">Identity (individual)</option>
            <option value="BUSINESS">Business / Organization</option>
            <option value="REVERIFICATION">Re-verification</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Document Type (optional)</label>
          <input value={documentType} onChange={(e) => setDocumentType(e.target.value)} placeholder="e.g. Government ID, Business License" className={inputClass} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Note</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="How this was received — phone call, email, etc." className={inputClass} />
        </div>
        <button type="button" onClick={submit} disabled={submitting} className="w-full px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
          {submitting ? 'Logging…' : 'Log Request'}
        </button>
      </div>
    </Modal>
  );
}

function ReviewModal({ request, onClose, onDecided }: { request: VerificationRequestRow; onClose: () => void; onDecided: () => void }) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    setSubmitting(true);
    try {
      await reviewVerificationRequest(request.id, { decision, reviewNote: note || undefined });
      toast.success(decision === 'APPROVED' ? 'Request approved' : 'Request rejected');
      onDecided();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record decision');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Review — ${request.user?.shortId}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div><span className="text-gray-500">Type</span><p className="text-gray-900">{request.requestType}</p></div>
        {request.documentType && <div><span className="text-gray-500">Document</span><p className="text-gray-900">{request.documentType}</p></div>}
        {request.submittedNote && <div><span className="text-gray-500">Submitted note</span><p className="text-gray-900">{request.submittedNote}</p></div>}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Review Note</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Reason for this decision" className={inputClass} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => decide('APPROVED')} disabled={submitting} className="flex-1 px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
            <Check size={14} /> Approve
          </button>
          <button type="button" onClick={() => decide('REJECTED')} disabled={submitting} className="flex-1 px-3 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
            <X size={14} /> Reject
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function VerificationRequestsPanel() {
  const [data, setData] = useState<{ requests: VerificationRequestRow[]; pendingCount: number; approvedCount: number; rejectedCount: number } | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [reviewing, setReviewing] = useState<VerificationRequestRow | null>(null);

  const load = () => {
    setLoading(true);
    fetchVerificationRequests({ status: status || undefined })
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(load, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <LightStatCard label="Pending" value={data?.pendingCount ?? 0} icon={Clock} />
        <LightStatCard label="Approved" value={data?.approvedCount ?? 0} icon={ShieldCheck} />
        <LightStatCard label="Rejected" value={data?.rejectedCount ?? 0} icon={ShieldX} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <button type="button" onClick={() => setNewOpen(true)} className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1.5 ml-auto">
          <Plus size={14} /> Log Request
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : (
        <LightDataTable
          rows={data?.requests ?? []}
          keyField="id"
          emptyMessage="No verification requests logged yet"
          onRowClick={(r: VerificationRequestRow) => r.status === 'PENDING' && setReviewing(r)}
          columns={[
            { key: 'user', header: 'User', render: (r: VerificationRequestRow) => <span className="font-mono text-xs">{r.user?.shortId ?? '—'}</span> },
            { key: 'type', header: 'Type', render: (r: VerificationRequestRow) => r.requestType },
            { key: 'status', header: 'Status', render: (r: VerificationRequestRow) => <LightStatusBadge value={r.status} /> },
            { key: 'document', header: 'Document', render: (r: VerificationRequestRow) => r.documentType ?? '—' },
            { key: 'reviewer', header: 'Reviewed By', render: (r: VerificationRequestRow) => r.reviewer?.shortId ?? '—' },
            { key: 'reviewedAt', header: 'Reviewed At', render: (r: VerificationRequestRow) => r.reviewedAt ? format(new Date(r.reviewedAt), 'MMM d, yyyy HH:mm') : '—' },
            { key: 'created', header: 'Logged', render: (r: VerificationRequestRow) => format(new Date(r.createdAt), 'MMM d, yyyy') },
            { key: 'actions', header: '', render: (r: VerificationRequestRow) => r.status === 'PENDING' ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); setReviewing(r); }} className="text-xs text-indigo-600 hover:underline">Review</button>
            ) : null },
          ]}
        />
      )}

      {newOpen && <NewRequestModal onClose={() => setNewOpen(false)} onCreated={load} />}
      {reviewing && <ReviewModal request={reviewing} onClose={() => setReviewing(null)} onDecided={load} />}
    </div>
  );
}
