import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { fetchAuditLogs, fetchAdminAuditLog } from '../api/super-admin.api';
import type { AdminAuditEvent } from '../api/super-admin.api';

function ActionDetailModal({ event, onClose }: { event: AdminAuditEvent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white border border-gray-200 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900">{event.action}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm">Close</button>
        </div>
        <div className="overflow-y-auto p-4 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-gray-500">Actor</span><p className="font-mono text-gray-900">{event.actorShortId ?? event.actorUserId}</p></div>
            <div><span className="text-gray-500">Time</span><p className="text-gray-900">{format(new Date(event.createdAt), 'MMM d, yyyy HH:mm:ss')}</p></div>
            <div><span className="text-gray-500">Target</span><p className="text-gray-900">{event.targetType ?? '—'} {event.targetId ? <span className="font-mono text-xs text-gray-500">{event.targetId}</span> : ''}</p></div>
            <div><span className="text-gray-500">IP</span><p className="font-mono text-xs text-gray-900">{event.ipAddress ?? '—'}</p></div>
            <div><span className="text-gray-500">Method / Path</span><p className="font-mono text-xs text-gray-900">{event.requestMethod ?? '—'} {event.requestPath ?? ''}</p></div>
            <div><span className="text-gray-500">Reason</span><p className="text-gray-900">{event.reason ?? '—'}</p></div>
          </div>
          {event.before != null && (
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Before</p>
              <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-700 overflow-x-auto">{JSON.stringify(event.before, null, 2)}</pre>
            </div>
          )}
          {event.after != null && (
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">After</p>
              <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-700 overflow-x-auto">{JSON.stringify(event.after, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuditPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [adminEvents, setAdminEvents] = useState<AdminAuditEvent[]>([]);
  const [tab, setTab] = useState<'logins' | 'share' | 'duplicate' | 'admin'>('logins');
  const [loading, setLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(true);
  const [detail, setDetail] = useState<AdminAuditEvent | null>(null);

  useEffect(() => {
    fetchAuditLogs()
      .then(setData)
      .finally(() => setLoading(false));
    fetchAdminAuditLog({ limit: 200 })
      .then((d) => setAdminEvents(d.events))
      .finally(() => setAdminLoading(false));
  }, []);

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {[
          { id: 'logins' as const, label: 'Login History' },
          { id: 'share' as const, label: 'Share Access' },
          { id: 'duplicate' as const, label: 'Duplicate Attempts' },
          { id: 'admin' as const, label: 'Admin Actions' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.id ? 'border-indigo-600 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'admin' ? (
        adminLoading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">
              Append-only record of destructive actions taken through this console — role changes, session revocations, device trust changes. Not editable or deletable.
            </p>
            <LightDataTable
              rows={adminEvents}
              keyField="id"
              emptyMessage="No admin actions recorded yet"
              onRowClick={(r) => setDetail(r)}
              columns={[
                { key: 'time', header: 'Time', render: (r: AdminAuditEvent) => format(new Date(r.createdAt), 'MMM d HH:mm:ss') },
                { key: 'actor', header: 'Actor', render: (r: AdminAuditEvent) => <span className="font-mono text-xs">{r.actorShortId ?? r.actorUserId.slice(0, 8)}</span> },
                { key: 'action', header: 'Action', render: (r: AdminAuditEvent) => <LightStatusBadge value={r.action} /> },
                { key: 'target', header: 'Target', render: (r: AdminAuditEvent) => (
                  <span>{r.targetType ?? '—'} {r.targetId && <span className="font-mono text-xs text-gray-400">{r.targetId.slice(0, 8)}…</span>}</span>
                )},
                { key: 'reason', header: 'Reason', render: (r: AdminAuditEvent) => r.reason ?? '—' },
                { key: 'ip', header: 'IP', render: (r: AdminAuditEvent) => <span className="font-mono text-xs">{r.ipAddress ?? '—'}</span> },
              ]}
            />
          </>
        )
      ) : loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : tab === 'logins' ? (
        <LightDataTable
          rows={data?.logins ?? []}
          keyField="id"
          columns={[
            { key: 'user', header: 'User', render: (r) => r.user?.shortId ?? '—' },
            { key: 'method', header: 'Method', render: (r) => r.method },
            { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ip ?? '—'}</span> },
            { key: 'location', header: 'Location', render: (r) => [r.city, r.country].filter(Boolean).join(', ') || '—' },
            { key: 'success', header: 'Result', render: (r) => r.success ? 'Success' : 'Failed' },
            { key: 'time', header: 'Time', render: (r) => format(new Date(r.createdAt), 'MMM d HH:mm') },
          ]}
        />
      ) : tab === 'share' ? (
        <LightDataTable
          rows={data?.shareAccess ?? []}
          keyField="id"
          columns={[
            { key: 'file', header: 'File', render: (r) => r.shareLink?.filename ?? '—' },
            { key: 'owner', header: 'Owner', render: (r) => r.shareLink?.ownerUser?.shortId ?? '—' },
            { key: 'action', header: 'Action', render: (r) => r.action },
            { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ipAddress ?? '—'}</span> },
            { key: 'time', header: 'Time', render: (r) => format(new Date(r.createdAt), 'MMM d HH:mm') },
          ]}
        />
      ) : (
        <LightDataTable
          rows={data?.duplicateAttempts ?? []}
          keyField="id"
          onRowClick={(r) => r.uploader?.id && navigate(`/users/${r.uploader.id}`)}
          columns={[
            { key: 'uploader', header: 'PINIT User (Attempted)', render: (r) => (
              <span className="font-mono text-gray-900">{r.uploader?.shortId ?? 'Not recorded'}</span>
            )},
            { key: 'file', header: 'Attempted File', render: (r) => <span className="max-w-[160px] truncate block">{r.filename ?? '—'}</span> },
            { key: 'existing', header: 'Existing File', render: (r) => <span className="max-w-[160px] truncate block">{r.existingFilename ?? '—'}</span> },
            { key: 'owner', header: 'Original Owner', render: (r) => <span className="font-mono text-xs">{r.originalOwner?.shortId ?? '—'}</span> },
            { key: 'match', header: 'Match', render: (r) => r.matchType ?? '—' },
            { key: 'risk', header: 'Risk', render: (r) => r.riskLevel ? <LightStatusBadge value={r.riskLevel} /> : '—' },
            { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ipAddress ?? '—'}</span> },
            { key: 'device', header: 'Device', render: (r) => [r.browser, r.os].filter(Boolean).join(' / ') || '—' },
            { key: 'time', header: 'Time', render: (r) => r.createdAt ? format(new Date(r.createdAt), 'MMM d HH:mm') : '—' },
          ]}
        />
      )}

      {detail && <ActionDetailModal event={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
