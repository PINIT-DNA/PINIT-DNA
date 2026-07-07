import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
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
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  const events = [
    ...(data?.timeline ?? []).map((e: any, i: number) => ({ id: `t-${i}`, ...e, source: 'provenance' })),
    ...(data?.downloads ?? []).map((e: any, i: number) => ({ id: `d-${i}`, ...e, source: 'download' })),
    ...(data?.auditEvents ?? []).map((e: any) => ({ id: e.id, eventType: e.eventType, timestamp: e.createdAt, detail: e.filename, source: 'audit' })),
  ].sort((a, b) => new Date(b.timestamp ?? b.createdAt).getTime() - new Date(a.timestamp ?? a.createdAt).getTime());

  return (
    <div>
      <button type="button" onClick={() => navigate('/admin/vault')} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300 mb-4">
        <ArrowLeft size={16} /> Back to Vault Explorer
      </button>
      <PageHeader
        title="Activity Timeline"
        description={data?.vault?.originalFileName ?? 'File activity history'}
      />

      <div className="relative border-l border-zinc-800 ml-3 space-y-0">
        {events.map((e) => (
          <div key={e.id} className="relative pl-8 pb-6">
            <div className="absolute left-0 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-zinc-500" />
            <p className="text-sm text-zinc-200">{e.eventType ?? e.stage ?? e.action ?? 'Event'}</p>
            {e.detail && <p className="text-xs text-zinc-500">{e.detail}</p>}
            {e.summary && <p className="text-xs text-zinc-500">{e.summary}</p>}
            <p className="text-[11px] text-zinc-600 mt-1">
              {format(new Date(e.timestamp ?? e.createdAt), 'MMM d, yyyy HH:mm:ss')}
            </p>
          </div>
        ))}
        {!events.length && <p className="text-sm text-zinc-500 pl-8">No timeline events</p>}
      </div>
    </div>
  );
}
