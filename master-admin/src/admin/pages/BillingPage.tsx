import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { IndianRupee, Users, AlertTriangle } from 'lucide-react';
import { LightStatCard } from '../components/LightStatCard';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { fetchBillingOverview } from '../api/super-admin.api';

function formatINR(cents: number): string {
  const rupees = cents / 100;
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(2)} Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(2)} L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return `₹${rupees.toFixed(0)}`;
}

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  storageLimitBytes: string | null;
  isActive: boolean;
  subscriberCounts: Record<string, number>;
};

type SubscriptionRow = {
  id: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  user: { id: string; shortId: string; fullName: string | null; email: string | null };
  plan: { code: string; name: string };
};

type BillingRow = {
  id: string;
  amountCents: number;
  currency: string;
  provider: string;
  status: string;
  createdAt: string;
  subscription: {
    user: { shortId: string; fullName: string | null };
    plan: { code: string; name: string };
  };
};

export function BillingPage() {
  const [data, setData] = useState<{
    summary: { totalRevenueCents: number; totalSubscriptions: number; failedPayments: number };
    plans: Plan[];
    subscriptions: SubscriptionRow[];
    billingHistory: BillingRow[];
  } | null>(null);
  const [tab, setTab] = useState<'subscriptions' | 'history'>('subscriptions');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBillingOverview()
      .then((d) => setData(d as typeof data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }

  const activeSubs = data?.subscriptions.filter((s) => s.status === 'ACTIVE').length ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <LightStatCard label="Total Revenue" value={formatINR(data?.summary.totalRevenueCents ?? 0)} icon={IndianRupee} />
        <LightStatCard label="Active Subscriptions" value={activeSubs} sub={`${data?.summary.totalSubscriptions ?? 0} total`} icon={Users} />
        <LightStatCard label="Failed Payments" value={data?.summary.failedPayments ?? 0} icon={AlertTriangle} />
      </div>

      <section>
        <h2 className="text-sm font-medium text-gray-900 mb-3">Plans</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {(data?.plans ?? []).map((p) => {
            const counts = p.subscriberCounts ?? {};
            const total = Object.values(counts).reduce((s, n) => s + n, 0);
            return (
              <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-gray-900">{p.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${p.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {p.description && <p className="text-xs text-gray-500 mb-2">{p.description}</p>}
                <p className="text-2xl font-semibold text-gray-900 tabular-nums">{total}</p>
                <p className="text-xs text-gray-500">subscriber{total === 1 ? '' : 's'}</p>
                {Object.keys(counts).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {Object.entries(counts).map(([status, count]) => (
                      <span key={status} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-500">
                        {status}: {count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="flex gap-1 border-b border-gray-200 mb-4">
          {[
            { id: 'subscriptions' as const, label: 'Subscriptions' },
            { id: 'history' as const, label: 'Billing History' },
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

        {tab === 'subscriptions' ? (
          <LightDataTable
            rows={data?.subscriptions ?? []}
            keyField="id"
            emptyMessage="No subscriptions yet"
            columns={[
              { key: 'user', header: 'User', render: (r: SubscriptionRow) => <span className="font-mono text-gray-900">{r.user?.shortId ?? '—'}</span> },
              { key: 'plan', header: 'Plan', render: (r: SubscriptionRow) => r.plan?.name ?? '—' },
              { key: 'status', header: 'Status', render: (r: SubscriptionRow) => <LightStatusBadge value={r.status} /> },
              { key: 'renews', header: 'Period Ends', render: (r: SubscriptionRow) => r.currentPeriodEnd ? format(new Date(r.currentPeriodEnd), 'MMM d, yyyy') : '—' },
              { key: 'cancel', header: 'Cancels at Period End', render: (r: SubscriptionRow) => r.cancelAtPeriodEnd ? 'Yes' : 'No' },
              { key: 'since', header: 'Subscribed', render: (r: SubscriptionRow) => format(new Date(r.createdAt), 'MMM d, yyyy') },
            ]}
          />
        ) : (
          <LightDataTable
            rows={data?.billingHistory ?? []}
            keyField="id"
            emptyMessage="No billing history yet"
            columns={[
              { key: 'user', header: 'User', render: (r: BillingRow) => <span className="font-mono text-gray-900">{r.subscription?.user?.shortId ?? '—'}</span> },
              { key: 'plan', header: 'Plan', render: (r: BillingRow) => r.subscription?.plan?.name ?? '—' },
              { key: 'amount', header: 'Amount', render: (r: BillingRow) => `${(r.amountCents / 100).toFixed(2)} ${r.currency}` },
              { key: 'provider', header: 'Provider', render: (r: BillingRow) => r.provider },
              { key: 'status', header: 'Status', render: (r: BillingRow) => <LightStatusBadge value={r.status} /> },
              { key: 'time', header: 'Date', render: (r: BillingRow) => format(new Date(r.createdAt), 'MMM d, yyyy HH:mm') },
            ]}
          />
        )}
      </section>
    </div>
  );
}
