import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CreditCard, Download, RefreshCw, Zap, Building2, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import {
  invalidateSubscriptionCache,
  useSubscription,
} from '../../hooks/useSubscription';
import { formatStorage, FALLBACK_PLANS } from '../../lib/subscription/plans';
import { fetchBillingHistory, type BillingHistoryRow } from '../../lib/subscription/payment-provider';
import { formatBytes } from '../../hooks/useApi';
import { downloadInvoiceReceipt, formatInvoiceNumber } from '../../lib/invoice-receipt';

export function SubscriptionPage() {
  const navigate = useNavigate();
  const { subscription, planCode, refresh, loading } = useSubscription();
  const [history, setHistory] = useState<BillingHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    fetchBillingHistory()
      .then(setHistory)
      .finally(() => setHistoryLoading(false));
  }, [planCode]);

  async function handleDowngrade() {
    if (!window.confirm('Downgrade to Free? Premium features will be locked at the end of this flow.')) return;
    setCancelling(true);
    try {
      await api.post(`${API_BASE_URL}/subscription/assign`, { planCode: 'FREE' });
      invalidateSubscriptionCache();
      await refresh();
      toast.success('Downgraded to Free plan');
    } catch {
      toast.error('Could not change plan');
    } finally {
      setCancelling(false);
    }
  }

  const planMeta = FALLBACK_PLANS.find((p) => p.code === planCode);
  const isPaid = planCode === 'PRO' || planCode === 'ENTERPRISE';

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-white">Subscription</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your plan, usage, and billing</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-bg-border bg-bg-card p-5">
          <p className="text-2xs font-semibold text-gray-500 uppercase mb-2">Current plan</p>
          <div className="flex items-center gap-3 mb-4">
            {planCode === 'ENTERPRISE' ? (
              <Building2 size={24} className="text-purple-400" />
            ) : planCode === 'PRO' ? (
              <Zap size={24} className="text-amber-400" />
            ) : (
              <CreditCard size={24} className="text-dna-400" />
            )}
            <div>
              <p className="text-xl font-bold text-white">{subscription?.planName ?? 'Free'}</p>
              <p className="text-xs text-gray-500">
                {isPaid ? `₹${planMeta?.priceInr ?? '—'}/month · Renews every 30 days` : 'Free forever'}
              </p>
            </div>
          </div>
          {!isPaid ? (
            <button
              type="button"
              onClick={() => navigate('/upgrade')}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold"
            >
              Upgrade to Pro or Enterprise
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate('/upgrade')}
                className="flex-1 py-2 rounded-xl border border-bg-border text-sm text-white hover:bg-bg-elevated"
              >
                Change plan
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={() => void handleDowngrade()}
                className="flex-1 py-2 rounded-xl border border-red-500/30 text-sm text-red-400 hover:bg-red-500/10"
              >
                {cancelling ? 'Updating…' : 'Cancel plan'}
              </button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-bg-border bg-bg-card p-5">
          <p className="text-2xs font-semibold text-gray-500 uppercase mb-2">Usage</p>
          {loading ? (
            <RefreshCw size={18} className="animate-spin text-gray-500" />
          ) : (
            <>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">Storage</span>
                  <span className="text-white">
                    {formatBytes(subscription?.storageUsedBytes ?? 0)}
                    {' / '}
                    {formatStorage(subscription?.storageLimitBytes ?? null)}
                  </span>
                </div>
                <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-dna-500 rounded-full transition-all"
                    style={{
                      width: subscription?.storageLimitBytes
                        ? `${Math.min(100, ((subscription.storageUsedBytes ?? 0) / subscription.storageLimitBytes) * 100)}%`
                        : '30%',
                    }}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Status: <span className="text-emerald-400">{subscription?.status ?? 'ACTIVE'}</span>
              </p>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-bg-border bg-bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-bg-border flex items-center justify-between">
          <h2 className="font-semibold text-white">Payment history</h2>
          <span className="text-2xs text-gray-500">Invoices available after live gateway</span>
        </div>
        {historyLoading ? (
          <div className="p-8 flex justify-center">
            <RefreshCw size={20} className="animate-spin text-gray-500" />
          </div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            <AlertTriangle size={24} className="mx-auto mb-2 text-gray-600" />
            No payments yet.{' '}
            <Link to="/upgrade" className="text-dna-400 hover:underline">Upgrade your plan</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border text-2xs uppercase text-gray-500">
                  <th className="text-left p-3 pl-5">Date</th>
                  <th className="text-left p-3">Plan</th>
                  <th className="text-left p-3">Transaction</th>
                  <th className="text-left p-3">Amount</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-right p-3 pr-5">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-b border-bg-border/50 last:border-0">
                    <td className="p-3 pl-5 text-gray-300">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-3 text-white font-medium">{row.planName}</td>
                    <td className="p-3 font-mono text-2xs text-gray-500">{row.transactionId}</td>
                    <td className="p-3 text-gray-300">₹{row.amountInr}</td>
                    <td className="p-3">
                      <span className={`text-2xs px-2 py-0.5 rounded border ${
                        row.status === 'SUCCEEDED'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                      }`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="p-3 pr-5 text-right">
                      <button
                        type="button"
                        disabled={row.status !== 'SUCCEEDED'}
                        title={
                          row.status === 'SUCCEEDED'
                            ? `Download ${formatInvoiceNumber(row)}`
                            : 'Receipt available after successful payment'
                        }
                        onClick={() => {
                          downloadInvoiceReceipt(row);
                          toast.success('Receipt downloaded');
                        }}
                        className="inline-flex items-center gap-1 text-2xs text-dna-400 hover:text-dna-300 disabled:text-gray-600 disabled:cursor-not-allowed"
                      >
                        <Download size={12} />
                        Receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-2xs text-gray-600 text-center">
        Download a receipt for any succeeded payment. Live Razorpay checkout is used when configured.
      </p>
    </div>
  );
}
