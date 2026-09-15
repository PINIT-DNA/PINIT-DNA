import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, ShieldAlert, ListChecks } from 'lucide-react';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { LightStatCard } from '../components/LightStatCard';
import { fetchIncidents, fetchIncidentDetail } from '../api/super-admin.api';
import type { IncidentRow } from '../api/super-admin.api';

function IncidentDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchIncidentDetail>>['incident'] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchIncidentDetail(id)
      .then((d) => setDetail(d.incident))
      .finally(() => setLoading(false));
  }, [id]);

  let metadata: Record<string, unknown> | null = null;
  try {
    metadata = detail?.metadata ? JSON.parse(detail.metadata) : null;
  } catch {
    metadata = null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white border border-gray-200 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900">{detail?.incidentCode ?? 'Incident'}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm">Close</button>
        </div>
        <div className="overflow-y-auto p-4 space-y-4 text-sm">
          {loading || !detail ? (
            <p className="text-gray-500">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-gray-500">Severity</span><p><LightStatusBadge value={detail.severity} /></p></div>
                <div><span className="text-gray-500">Status</span><p><LightStatusBadge value={detail.status} /></p></div>
                <div><span className="text-gray-500">Trigger</span><p className="text-gray-900">{detail.triggerType}</p></div>
                <div><span className="text-gray-500">Created</span><p className="text-gray-900">{format(new Date(detail.createdAt), 'MMM d, yyyy HH:mm')}</p></div>
                <div className="col-span-2"><span className="text-gray-500">Description</span><p className="text-gray-900">{detail.description}</p></div>
                {detail.dnaRecord && (
                  <div className="col-span-2"><span className="text-gray-500">Asset</span><p className="text-gray-900">{detail.dnaRecord.imageFilename} — <span className="font-mono text-xs">{detail.dnaRecord.ownerUser?.shortId}</span></p></div>
                )}
                {detail.resolvedNote && (
                  <div className="col-span-2"><span className="text-gray-500">Resolution</span><p className="text-gray-900">{detail.resolvedNote}</p></div>
                )}
              </div>

              {metadata && (
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Match Details</p>
                  <div className="bg-gray-50 border border-gray-200 rounded p-3 space-y-1 text-xs">
                    {metadata['platform'] != null && <p><span className="text-gray-500">Platform:</span> <span className="text-gray-900">{String(metadata['platform'])}</span></p>}
                    {metadata['similarity'] != null && <p><span className="text-gray-500">Similarity:</span> <span className="text-gray-900">{(Number(metadata['similarity']) * 100).toFixed(1)}%</span></p>}
                    {metadata['matchType'] != null && <p><span className="text-gray-500">Match type:</span> <span className="text-gray-900">{String(metadata['matchType'])}</span></p>}
                    {metadata['method'] != null && <p><span className="text-gray-500">Method:</span> <span className="text-gray-900">{String(metadata['method'])}</span></p>}
                    {metadata['sourceUrl'] != null && <p className="break-all"><span className="text-gray-500">Source:</span> <span className="text-gray-900">{String(metadata['sourceUrl'])}</span></p>}
                  </div>
                </div>
              )}

              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Evidence ({detail.evidenceRecords.length})</p>
                {detail.evidenceRecords.length === 0 ? (
                  <p className="text-xs text-gray-400">No evidence records collected</p>
                ) : (
                  <div className="space-y-2">
                    {(detail.evidenceRecords as { id: string; evidenceCode: string; evidenceType: string; description: string }[]).map((e) => (
                      <div key={e.id} className="border border-gray-200 rounded p-2 text-xs">
                        <p className="font-mono text-gray-700">{e.evidenceCode}</p>
                        <p className="text-gray-500">{e.evidenceType} — {e.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Notes ({detail.notes.length})</p>
                {detail.notes.length === 0 ? (
                  <p className="text-xs text-gray-400">No notes yet</p>
                ) : (
                  <div className="space-y-2">
                    {(detail.notes as { id: string; authorLabel: string; body: string; createdAt: string }[]).map((n) => (
                      <div key={n.id} className="border-l-2 border-gray-200 pl-3 text-xs">
                        <p className="text-gray-900">{n.body}</p>
                        <p className="text-gray-400">{n.authorLabel} — {format(new Date(n.createdAt), 'MMM d HH:mm')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ThreatCenterPage() {
  const [data, setData] = useState<{ incidents: IncidentRow[]; total: number; openCount: number; highCount: number } | null>(null);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchIncidents({ status: status || undefined, severity: severity || undefined, limit: 200 })
      .then(setData)
      .finally(() => setLoading(false));
  }, [status, severity]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <LightStatCard label="Open Incidents" value={data?.openCount ?? 0} icon={AlertTriangle} />
        <LightStatCard label="High Severity (Open)" value={data?.highCount ?? 0} icon={ShieldAlert} />
        <LightStatCard label="Matching Filter" value={data?.total ?? 0} icon={ListChecks} />
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">All severities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : (
        <LightDataTable
          rows={data?.incidents ?? []}
          keyField="id"
          emptyMessage="No incidents match this filter"
          onRowClick={(r: IncidentRow) => setDetailId(r.id)}
          columns={[
            { key: 'code', header: 'Incident', render: (r: IncidentRow) => <span className="font-mono text-xs">{r.incidentCode}</span> },
            { key: 'asset', header: 'Asset', render: (r: IncidentRow) => r.dnaRecord ? <span className="max-w-[160px] truncate block">{r.dnaRecord.imageFilename}</span> : '—' },
            { key: 'owner', header: 'Owner', render: (r: IncidentRow) => r.dnaRecord ? <span className="font-mono text-xs">{r.dnaRecord.ownerUser?.shortId}</span> : '—' },
            { key: 'severity', header: 'Severity', render: (r: IncidentRow) => <LightStatusBadge value={r.severity} /> },
            { key: 'status', header: 'Status', render: (r: IncidentRow) => <LightStatusBadge value={r.status} /> },
            { key: 'trigger', header: 'Trigger', render: (r: IncidentRow) => r.triggerType },
            { key: 'description', header: 'Description', render: (r: IncidentRow) => <span className="max-w-[260px] truncate block">{r.description}</span> },
            { key: 'evidence', header: 'Evidence', render: (r: IncidentRow) => r.evidenceCount },
            { key: 'created', header: 'Created', render: (r: IncidentRow) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}

      {detailId && <IncidentDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
