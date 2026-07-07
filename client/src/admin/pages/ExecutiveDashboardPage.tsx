import { useEffect, useState } from 'react';
import {
  Users, Database, Shield, Activity, FileText, Download, Link2,
  Radar, Award, Dna, AlertTriangle, CheckCircle, Globe, Search,
} from 'lucide-react';
import { format } from 'date-fns';
import { StatCard } from '../components/StatCard';
import { fetchExecutiveOverview, fetchSystemHealth, fetchActivity, fetchAnalytics } from '../api/super-admin.api';
import { formatBytes } from '../../hooks/useApi';

export function ExecutiveDashboardPage() {
  const [overview, setOverview] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [activity, setActivity] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchExecutiveOverview(),
      fetchSystemHealth(),
      fetchActivity(),
      fetchAnalytics(),
    ])
      .then(([o, h, a, an]) => {
        setOverview(o);
        setHealth(h);
        setActivity(a);
        setAnalytics(an);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const o = overview ?? {};
  const h = health ?? {};

  return (
    <div className="space-y-6 max-w-[1600px]">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Executive Overview</h1>
        <p className="text-sm text-zinc-500 mt-1">Platform-wide metrics across all tenants</p>
      </div>

      {/* System health strip */}
      <div className="flex flex-wrap gap-3">
        {['database', 'vault', 'storage', 'encryption', 'supabase', 'memory'].map((key) => {
          const comp = h.components?.[key];
          const ok = comp?.status === 'healthy';
          return (
            <div
              key={key}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs ${
                ok ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-400' : 'border-amber-900/50 bg-amber-950/30 text-amber-400'
              }`}
            >
              {ok ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
              <span className="capitalize">{key}</span>
              <span className="text-zinc-500">{comp?.latencyMs ? `${comp.latencyMs}ms` : comp?.message?.slice(0, 20)}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-800 text-xs text-zinc-400">
          API {h.status ?? '—'} · v{h.version ?? '—'}
        </div>
      </div>

      {/* User metrics */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">Users & Identity</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Total Users" value={o.users?.total ?? 0} icon={Users} />
          <StatCard label="Active Users" value={o.users?.active ?? 0} icon={Users} />
          <StatCard label="New Today" value={o.users?.newToday ?? 0} sub={`${o.users?.newWeek ?? 0} this week`} icon={Activity} />
          <StatCard label="Biometric" value={o.users?.biometric ?? 0} icon={Shield} />
          <StatCard label="Organizations" value={o.users?.organizations ?? 0} icon={Globe} />
          <StatCard label="Logins Today" value={o.security?.loginsToday ?? 0} icon={Activity} />
        </div>
      </section>

      {/* Files & storage */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">Files & Storage</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <StatCard label="DNA Generated" value={o.files?.dnaGenerated ?? 0} icon={Dna} />
          <StatCard label="Vault Files" value={o.files?.vaultFiles ?? 0} icon={Database} />
          <StatCard label="Storage Used" value={formatBytes(o.files?.storageOriginalBytes ?? 0)} sub={`Encrypted: ${formatBytes(o.files?.storageEncryptedBytes ?? 0)}`} icon={FileText} />
          <StatCard label="Certificates" value={o.certificates?.total ?? 0} sub={`${o.certificates?.active ?? 0} active`} icon={Award} />
          <StatCard label="Investigations" value={o.investigations?.total ?? 0} sub={`${o.investigations?.tampered ?? 0} tampered`} icon={Search} />
        </div>
      </section>

      {/* Sharing & security */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">Sharing & Security</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Share Links" value={o.sharing?.links ?? 0} sub={`${o.sharing?.activeLinks ?? 0} active`} icon={Link2} />
          <StatCard label="Link Views" value={o.sharing?.views ?? 0} icon={Activity} />
          <StatCard label="Downloads" value={o.sharing?.downloads ?? 0} icon={Download} />
          <StatCard label="TEP Packages" value={o.protectedDownloads?.tepPackages ?? 0} icon={Download} />
          <StatCard label="Monitors" value={o.monitoring?.active ?? 0} sub={`${o.monitoring?.total ?? 0} total`} icon={Radar} />
          <StatCard label="Duplicates" value={o.security?.duplicateAttempts ?? 0} icon={AlertTriangle} />
        </div>
      </section>

      {/* Geo + activity */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-[#111113] border border-zinc-800 rounded-lg p-4">
          <h2 className="text-sm font-medium text-zinc-200 mb-3">Top Countries (30d logins)</h2>
          <div className="space-y-2">
            {(analytics?.geo?.countries ?? []).slice(0, 8).map((c: { name: string; count: number }) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">{c.name ?? 'Unknown'}</span>
                <span className="text-zinc-200 tabular-nums">{c.count}</span>
              </div>
            ))}
            {!(analytics?.geo?.countries?.length) && <p className="text-sm text-zinc-500">No geo data yet</p>}
          </div>
        </section>

        <section className="bg-[#111113] border border-zinc-800 rounded-lg p-4">
          <h2 className="text-sm font-medium text-zinc-200 mb-3">Recent Activity</h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(activity?.logins ?? []).slice(0, 6).map((l: any) => (
              <div key={l.id} className="flex items-center justify-between text-xs border-b border-zinc-800/50 pb-2">
                <span className="text-zinc-400">{l.user?.shortId} · {l.method}</span>
                <span className="text-zinc-500">{format(new Date(l.createdAt), 'MMM d HH:mm')}</span>
              </div>
            ))}
            {(activity?.uploads ?? []).slice(0, 4).map((u: any) => (
              <div key={u.id} className="flex items-center justify-between text-xs border-b border-zinc-800/50 pb-2">
                <span className="text-zinc-400 truncate max-w-[200px]">DNA: {u.imageFilename}</span>
                <span className="text-zinc-500">{u.ownerUser?.shortId}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* File type breakdown */}
      {analytics?.fileTypes && (
        <section className="bg-[#111113] border border-zinc-800 rounded-lg p-4">
          <h2 className="text-sm font-medium text-zinc-200 mb-3">DNA by File Type (30d)</h2>
          <div className="flex flex-wrap gap-4">
            {Object.entries(analytics.fileTypes as Record<string, number>).map(([type, count]) => (
              <div key={type} className="text-sm">
                <span className="text-zinc-500">{type}</span>
                <span className="ml-2 text-zinc-200 font-medium">{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
