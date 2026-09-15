import { useEffect, useState } from 'react';
import { LightStatCard } from '../components/LightStatCard';
import { fetchAnalytics } from '../api/super-admin.api';
import { Users, Dna, Globe, MapPin } from 'lucide-react';

function BarChart({ data, labelKey, valueKey }: { data: { name: string; count: number }[]; labelKey?: string; valueKey?: string }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-2">
      {data.slice(0, 10).map((item) => {
        const label = labelKey ? (item as any)[labelKey] : item.name;
        const value = valueKey ? (item as any)[valueKey] : item.count;
        return (
          <div key={String(label)} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-28 truncate shrink-0">{label ?? 'Unknown'}</span>
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${(value / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 tabular-nums w-8 text-right">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  const fileTypes = Object.entries(data?.fileTypes ?? {}).map(([name, count]) => ({ name, count: count as number }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <LightStatCard label="New Users (30d)" value={data?.growth?.users ?? 0} icon={Users} />
        <LightStatCard label="DNA Generated (30d)" value={data?.growth?.dna ?? 0} icon={Dna} />
        <LightStatCard label="Countries" value={data?.geo?.countries?.length ?? 0} icon={Globe} />
        <LightStatCard label="Cities" value={data?.geo?.cities?.length ?? 0} icon={MapPin} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-medium text-gray-900 mb-4">Top Countries</h2>
          <BarChart data={data?.geo?.countries ?? []} />
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-medium text-gray-900 mb-4">Top Cities</h2>
          <BarChart data={data?.geo?.cities ?? []} />
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5 lg:col-span-2">
          <h2 className="text-sm font-medium text-gray-900 mb-4">DNA by Asset Type</h2>
          {fileTypes.length ? <BarChart data={fileTypes} /> : <p className="text-sm text-gray-500">No data</p>}
        </section>
      </div>
    </div>
  );
}
