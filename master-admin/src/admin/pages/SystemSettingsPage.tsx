import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Check, X, Clock, Tag, Activity } from 'lucide-react';
import { LightStatCard } from '../components/LightStatCard';
import { fetchSystemHealth, fetchRbacMatrix } from '../api/super-admin.api';
import type { HealthReport, ComponentHealth } from '../api/super-admin.api';

const STATUS_STYLE: Record<string, string> = {
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  degraded: 'bg-amber-50 text-amber-700 border-amber-200',
  unhealthy: 'bg-red-50 text-red-700 border-red-200',
};

const COMPONENT_LABEL: Record<string, string> = {
  database: 'Database',
  vault: 'Vault Directory',
  storage: 'Upload Storage',
  encryption: 'Encryption Config',
  supabase: 'Supabase Storage',
  memory: 'System Memory',
};

const ROLE_ORDER = ['SUPER_ADMIN', 'ADMIN', 'ANALYST', 'AUDITOR', 'USER'];

function ComponentCard({ name, health }: { name: string; health: ComponentHealth }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium text-gray-900">{COMPONENT_LABEL[name] ?? name}</p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase font-medium ${STATUS_STYLE[health.status]}`}>{health.status}</span>
      </div>
      <p className="text-xs text-gray-500">{health.message}</p>
      {health.latencyMs != null && <p className="text-[11px] text-gray-400 mt-1">{health.latencyMs}ms</p>}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

export function SystemSettingsPage() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [rbac, setRbac] = useState<Awaited<ReturnType<typeof fetchRbacMatrix>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchSystemHealth(), fetchRbacMatrix()])
      .then(([h, r]) => { setHealth(h); setRbac(r); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <LightStatCard label="Overall Status" value={health?.status ?? '—'} icon={Activity} />
          <LightStatCard label="Uptime" value={health ? formatUptime(health.uptime) : '—'} icon={Clock} />
          <LightStatCard label="Engine Version" value={health?.version ?? '—'} icon={Tag} />
        </div>
        <h2 className="text-sm font-medium text-gray-900 mb-3">System Health</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {health && Object.entries(health.components).map(([name, h]) => (
            <ComponentCard key={name} name={name} health={h} />
          ))}
        </div>
        {health && <p className="text-[11px] text-gray-400 mt-2">Last checked {format(new Date(health.timestamp), 'MMM d, yyyy HH:mm:ss')}</p>}
      </section>

      <section>
        <h2 className="text-sm font-medium text-gray-900 mb-1">RBAC Capability Matrix</h2>
        <p className="text-xs text-gray-500 mb-3">{rbac?.platformOwnerNote}</p>
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider font-medium text-gray-500">Domain</th>
                  {ROLE_ORDER.map((role) => (
                    <th key={role} className="text-center px-3 py-3 text-[11px] uppercase tracking-wider font-medium text-gray-500">{role.replace('_', ' ')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rbac?.domains.map((d) => (
                  <tr key={d.key} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{d.label}</p>
                      <p className="text-xs text-gray-400">{d.description}</p>
                    </td>
                    {ROLE_ORDER.map((role) => {
                      const has = rbac.matrix[role]?.includes(d.key);
                      return (
                        <td key={role} className="text-center px-3 py-3">
                          {has ? <Check size={16} className="text-emerald-600 inline" /> : <X size={16} className="text-gray-300 inline" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
