import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Building2, Boxes, ShieldCheck, ShoppingCart, IndianRupee,
  TrendingUp, TrendingDown, ArrowUpRight, AlertTriangle, Search,
  Dna, FileCheck, Radar, ShoppingBag, ClipboardList, Receipt,
  Wallet, ScrollText, Inbox, Settings,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { format } from 'date-fns';
import { fetchCommandCenterSummary } from '../api/super-admin.api';
import type { CommandCenterSummary } from '../api/super-admin.api';

const DONUT_COLORS = ['#6366F1', '#3B82F6', '#10B981', '#F59E0B', '#94A3B8'];

function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

function formatINR(cents: number): string {
  const rupees = cents / 100;
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(2)} Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(2)} L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return `₹${rupees.toFixed(0)}`;
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-gray-400">new this period</span>;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {up ? '+' : ''}{pct}%
    </span>
  );
}

function KpiTile({
  label, value, delta, icon: Icon, iconBg, iconColor, unavailable,
}: {
  label: string; value: string; delta: number | null; icon: typeof Users;
  iconBg: string; iconColor: string; unavailable?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
          <Icon size={16} className={iconColor} />
        </div>
      </div>
      <p className="text-2xl font-semibold text-gray-900 tabular-nums">{value}</p>
      <div className="mt-1.5">
        {unavailable ? (
          <span className="text-xs text-gray-400">Not connected yet</span>
        ) : (
          <>
            <DeltaBadge pct={delta} /> <span className="text-xs text-gray-400">vs last 7 days</span>
          </>
        )}
      </div>
    </div>
  );
}

const QUICK_MODULES = [
  { label: 'User Search', icon: Search, to: '/users' },
  { label: 'Asset Lookup', icon: Boxes, to: '/dna' },
  { label: 'DNA Verify', icon: Dna, to: '/dna' },
  { label: 'Sentinel Console', icon: ShieldCheck, to: '/investigations' },
  { label: 'Marketplace', icon: ShoppingBag, to: '/marketplace' },
  { label: 'Orders', icon: ClipboardList, to: '/marketplace' },
  { label: 'Refunds', icon: Receipt, to: '/billing' },
  { label: 'Payouts', icon: Wallet, to: '/billing' },
  { label: 'Reports', icon: FileCheck, to: '/analytics' },
  { label: 'System Logs', icon: ScrollText, to: '/audit' },
  { label: 'Support Inbox', icon: Inbox, to: '/support' },
  { label: 'Settings', icon: Settings, to: '/settings' },
];

export function ExecutiveDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<CommandCenterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCommandCenterSummary()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
        {error ?? 'Could not load the Command Center'}
      </div>
    );
  }

  const { kpis, activityOverview, sentinel, activityFeed, alerts, revenueBreakdown } = data;
  const chartData = activityOverview.map((d) => ({
    ...d,
    label: format(new Date(d.date), 'MMM d'),
  }));
  const sentinelChart = sentinel.breakdown.map((b) => ({ name: b.label, value: b.count, pct: b.pct }));
  const revenueChart = revenueBreakdown.filter((r) => r.amountCents > 0).map((r) => ({ name: r.label, value: r.amountCents }));
  const totalRevenue = revenueBreakdown.reduce((s, r) => s + r.amountCents, 0);

  return (
    <div className="space-y-6 w-full">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiTile label="Total Users" value={formatCompact(kpis.totalUsers)} delta={kpis.totalUsersDeltaPct} icon={Users} iconBg="bg-indigo-50" iconColor="text-indigo-600" />
        <KpiTile label="Organizations" value={formatCompact(kpis.organizations)} delta={kpis.organizationsDeltaPct} icon={Building2} iconBg="bg-blue-50" iconColor="text-blue-600" />
        <KpiTile label="Total Assets" value={formatCompact(kpis.totalAssets)} delta={kpis.totalAssetsDeltaPct} icon={Boxes} iconBg="bg-teal-50" iconColor="text-teal-600" />
        <KpiTile label="DNA Protected" value={formatCompact(kpis.dnaProtected)} delta={kpis.dnaProtectedDeltaPct} icon={ShieldCheck} iconBg="bg-emerald-50" iconColor="text-emerald-600" />
        <KpiTile label="Marketplace GMV" value="—" delta={null} unavailable icon={ShoppingCart} iconBg="bg-orange-50" iconColor="text-orange-600" />
        <KpiTile label="Platform Revenue" value={formatINR(kpis.platformRevenueCents)} delta={null} icon={IndianRupee} iconBg="bg-purple-50" iconColor="text-purple-600" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Platform Activity Overview */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Platform Activity Overview</h2>
            <span className="text-xs text-gray-400">Last 7 days</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 13, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 13, fill: '#64748B' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RTooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 14 }}
                labelStyle={{ color: '#111827', fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ fontSize: 14 }} />
              <Line type="monotone" dataKey="users" name="Users" stroke="#6366F1" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="assets" name="Assets" stroke="#3B82F6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="dnaProtected" name="DNA Protected" stroke="#10B981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Sentinel Intelligence */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Sentinel Intelligence</h2>
          {sentinelChart.length > 0 ? (
            <>
              <div className="relative">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={sentinelChart} dataKey="value" nameKey="name" innerRadius={48} outerRadius={68} paddingAngle={2}>
                      {sentinelChart.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                    </Pie>
                    <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 14 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-[10px] text-gray-400">Total Events</p>
                  <p className="text-lg font-semibold text-gray-900 tabular-nums">{formatCompact(sentinel.totalInvestigations)}</p>
                </div>
              </div>
              <div className="space-y-1.5 mt-2">
                {sentinelChart.map((s, i) => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <span className="w-2 h-2 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      {s.name}
                    </span>
                    <span className="text-gray-900 font-medium tabular-nums">{formatCompact(s.value)} ({s.pct}%)</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">No forensic events logged yet</p>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Real-time Activity Feed */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Real-time Activity Feed</h2>
          </div>
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {activityFeed.length ? activityFeed.map((a) => (
              <div key={a.id} className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
                  <ArrowUpRight size={13} className="text-indigo-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-800 truncate">{a.summary}</p>
                  <p className="text-[11px] text-gray-400">{format(new Date(a.createdAt), 'MMM d, HH:mm')}</p>
                </div>
              </div>
            )) : <p className="text-sm text-gray-400 py-8 text-center">No recent activity</p>}
          </div>
        </div>

        {/* Top Performing Categories — Exchange not connected */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Top Performing Categories (Marketplace)</h2>
          <p className="text-xs text-gray-400 mb-4">Exchange integration required — planned for a later release</p>
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Not connected yet</div>
        </div>

        {/* Revenue Breakdown */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Revenue Breakdown</h2>
          </div>
          {revenueChart.length > 0 ? (
            <>
              <div className="relative">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={revenueChart} dataKey="value" nameKey="name" innerRadius={48} outerRadius={68} paddingAngle={2}>
                      {revenueChart.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                    </Pie>
                    <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 14 }} formatter={(v) => formatINR(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-[10px] text-gray-400">Total Revenue</p>
                  <p className="text-base font-semibold text-gray-900">{formatINR(totalRevenue)}</p>
                </div>
              </div>
              <div className="space-y-1.5 mt-2">
                {revenueChart.map((r, i) => (
                  <div key={r.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <span className="w-2 h-2 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      {r.name}
                    </span>
                    <span className="text-gray-900 font-medium">{formatINR(r.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">No billed revenue yet</p>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Recent Orders — Exchange not connected */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Recent Orders</h2>
          <p className="text-xs text-gray-400 mb-4">Exchange integration required — planned for a later release</p>
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">Not connected yet</div>
        </div>

        {/* Critical Alerts */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Critical Alerts</h2>
          <div className="space-y-2">
            {alerts.length ? alerts.map((a) => (
              <div
                key={a.id}
                className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${
                  a.severity === 'critical' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
                }`}
              >
                <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${a.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
                <div className="min-w-0">
                  <p className={`text-xs font-medium ${a.severity === 'critical' ? 'text-red-800' : 'text-amber-800'}`}>{a.title}</p>
                  <p className="text-[11px] text-gray-500">{a.detail}</p>
                </div>
              </div>
            )) : <p className="text-sm text-gray-400 py-6 text-center">No active alerts</p>}
          </div>
        </div>
      </div>

      {/* Quick Access Modules */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Access Modules</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {QUICK_MODULES.map(({ label, icon: Icon, to }) => (
            <button
              key={label}
              type="button"
              onClick={() => navigate(to)}
              className="flex flex-col items-center gap-2 p-3 rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/50 transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
                <Icon size={17} className="text-gray-600" />
              </div>
              <span className="text-[11px] font-medium text-gray-600 text-center leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {!!(data.kpis.marketplaceGmvCents === null) && (
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
          <Radar size={12} /> Marketplace figures show real data once the Exchange app has a stats bridge to Hub — see the roadmap's Commerce section.
        </p>
      )}
    </div>
  );
}
