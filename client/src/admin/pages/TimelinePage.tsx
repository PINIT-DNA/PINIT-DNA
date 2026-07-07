import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { PageHeader } from '../components/PageHeader';
import { fetchActivity } from '../api/super-admin.api';

export function TimelinePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivity()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const events = [
    ...(data?.logins ?? []).map((l: any) => ({
      id: `login-${l.id}`,
      type: 'login',
      title: `${l.user?.shortId ?? 'User'} logged in via ${l.method}`,
      sub: [l.city, l.country, l.ip].filter(Boolean).join(' · '),
      time: l.createdAt,
      success: l.success,
    })),
    ...(data?.uploads ?? []).map((u: any) => ({
      id: `upload-${u.id}`,
      type: 'upload',
      title: `DNA generated: ${u.imageFilename}`,
      sub: `${u.ownerUser?.shortId} · ${u.fileType}`,
      time: u.createdAt,
    })),
    ...(data?.investigations ?? []).map((i: any) => ({
      id: `inv-${i.id}`,
      type: 'investigation',
      title: `Investigation: ${i.eventType}`,
      sub: i.dnaRecordId?.slice(0, 16),
      time: i.createdAt,
    })),
    ...(data?.downloads ?? []).map((d: any) => ({
      id: `dl-${d.id}`,
      type: 'download',
      title: `Download event: ${d.eventType}`,
      sub: d.dnaRecordId?.slice(0, 16),
      time: d.createdAt,
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const dotColor: Record<string, string> = {
    login: 'bg-blue-500',
    upload: 'bg-emerald-500',
    investigation: 'bg-amber-500',
    download: 'bg-violet-500',
  };

  return (
    <div>
      <PageHeader title="Activity Timeline" description="Live platform activity stream" />

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="relative border-l border-zinc-800 ml-3 space-y-0">
          {events.slice(0, 50).map((e) => (
            <div key={e.id} className="relative pl-8 pb-6">
              <div className={`absolute left-0 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${dotColor[e.type] ?? 'bg-zinc-500'}`} />
              <p className="text-sm text-zinc-200">{e.title}</p>
              {e.sub && <p className="text-xs text-zinc-500 mt-0.5">{e.sub}</p>}
              <p className="text-[11px] text-zinc-600 mt-1">{format(new Date(e.time), 'MMM d, yyyy HH:mm:ss')}</p>
            </div>
          ))}
          {!events.length && <p className="text-sm text-zinc-500 pl-8">No activity yet</p>}
        </div>
      )}
    </div>
  );
}
