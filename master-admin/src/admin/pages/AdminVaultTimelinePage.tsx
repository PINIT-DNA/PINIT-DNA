import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { fetchVaultTimeline } from '../api/super-admin.api';

export function AdminVaultTimelinePage() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vaultId) return;
    fetchVaultTimeline(vaultId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [vaultId]);

  if (loading) {
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }

  const events = [
    ...(data?.timeline ?? []).map((e: any, i: number) => ({ id: `t-${i}`, ...e, source: 'provenance' })),
    ...(data?.downloads ?? []).map((e: any, i: number) => ({ id: `d-${i}`, ...e, source: 'download' })),
    ...(data?.auditEvents ?? []).map((e: any) => ({ id: e.id, eventType: e.eventType, timestamp: e.createdAt, detail: e.filename, source: 'audit' })),
  ].sort((a, b) => new Date(b.timestamp ?? b.createdAt).getTime() - new Date(a.timestamp ?? a.createdAt).getTime());

  return (
    <div>
      <button type="button" onClick={() => navigate('/vault')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={16} /> Back to Vault Explorer
      </button>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Activity Timeline</h1>
        <p className="text-sm text-gray-500 mt-1">{data?.vault?.originalFileName ?? 'File activity history'}</p>
      </div>

      <div className="relative border-l border-gray-200 ml-3 space-y-0">
        {events.map((e) => (
          <div key={e.id} className="relative pl-8 pb-6">
            <div className="absolute left-0 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <p className="text-sm text-gray-900">{e.eventType ?? e.stage ?? e.action ?? 'Event'}</p>
            {e.detail && <p className="text-xs text-gray-500">{e.detail}</p>}
            {e.summary && <p className="text-xs text-gray-500">{e.summary}</p>}
            <p className="text-[11px] text-gray-400 mt-1">
              {format(new Date(e.timestamp ?? e.createdAt), 'MMM d, yyyy HH:mm:ss')}
            </p>
          </div>
        ))}
        {!events.length && <p className="text-sm text-gray-500 pl-8">No timeline events</p>}
      </div>
    </div>
  );
}
