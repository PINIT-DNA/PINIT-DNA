import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Building2, Zap } from 'lucide-react';
import { SubscriptionFlowShell } from '../../components/subscription/SubscriptionFlowShell';
import {
  FALLBACK_PLANS,
  PLAN_HIGHLIGHTS,
  formatStorage,
  getPlan,
  isPaidPlan,
} from '../../lib/subscription/plans';
import { loadCheckoutSession, saveCheckoutSession } from '../../lib/subscription/checkout-session';
import { useSubscription } from '../../hooks/useSubscription';
import type { PlanCode } from '../../hooks/useSubscription';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';

export function CheckoutPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { planCode } = useSubscription();
  const [plans, setPlans] = useState(FALLBACK_PLANS);

  const planParam = searchParams.get('plan') as PlanCode | null;
  const session = loadCheckoutSession();

  const selectedCode = (planParam && isPaidPlan(planParam) ? planParam : session?.planCode) as PlanCode | undefined;
  const plan = useMemo(() => getPlan(selectedCode ?? null, plans), [selectedCode, plans]);

  useEffect(() => {
    api.get<{ plans?: typeof FALLBACK_PLANS }>(`${API_BASE_URL}/subscription/plans`)
      .then((r) => { if (r.data?.plans?.length) setPlans(r.data.plans); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedCode || !isPaidPlan(selectedCode)) {
      navigate('/upgrade', { replace: true });
      return;
    }
    if (selectedCode === planCode) {
      navigate('/subscription', { replace: true });
      return;
    }
    saveCheckoutSession({
      ...(session ?? { returnTo: '/', billingCycle: 'monthly' }),
      planCode: selectedCode,
    });
  }, [selectedCode, planCode, navigate, session]);

  if (!plan || !selectedCode) return null;

  const highlights = PLAN_HIGHLIGHTS[plan.code] ?? [];
  const Icon = plan.code === 'ENTERPRISE' ? Building2 : Zap;

  return (
    <SubscriptionFlowShell
      title="Review your plan"
      subtitle="Confirm details before payment"
      step={{ current: 1, total: 3, label: 'Checkout' }}
      backTo="/upgrade"
      backLabel="Change plan"
    >
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div
            className={`rounded-2xl border p-5 ${
              plan.code === 'ENTERPRISE'
                ? 'border-purple-500/40 bg-purple-500/5'
                : 'border-amber-500/40 bg-amber-500/5'
            }`}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  plan.code === 'ENTERPRISE' ? 'bg-purple-500/20' : 'bg-amber-500/20'
                }`}
              >
                <Icon size={20} className={plan.code === 'ENTERPRISE' ? 'text-purple-400' : 'text-amber-400'} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">PINITHub {plan.name}</h2>
                <p className="text-xs text-gray-500">{plan.description}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div className="rounded-lg bg-bg-elevated p-3">
                <p className="text-2xs text-gray-500">Billing cycle</p>
                <p className="font-medium text-white">Monthly</p>
              </div>
              <div className="rounded-lg bg-bg-elevated p-3">
                <p className="text-2xs text-gray-500">Storage</p>
                <p className="font-medium text-white">{formatStorage(plan.storageLimitBytes)}</p>
              </div>
              <div className="rounded-lg bg-bg-elevated p-3">
                <p className="text-2xs text-gray-500">Investigation</p>
                <p className="font-medium text-emerald-400">Included</p>
              </div>
              <div className="rounded-lg bg-bg-elevated p-3">
                <p className="text-2xs text-gray-500">Tracking & Monitoring</p>
                <p className="font-medium text-emerald-400">Included</p>
              </div>
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Included features</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {highlights.map((h) => (
                <li key={h} className="flex items-center gap-2 text-xs text-gray-300">
                  <Check size={12} className="text-emerald-400 shrink-0" />
                  {h}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-bg-border bg-bg-card p-5 sticky top-4">
            <h3 className="font-semibold text-white mb-4">Order summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>{plan.name} plan</span>
                <span>₹{plan.priceInr}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Billing</span>
                <span>Monthly</span>
              </div>
              <div className="border-t border-bg-border pt-2 mt-2 flex justify-between font-bold text-white">
                <span>Total due today</span>
                <span>₹{plan.priceInr}</span>
              </div>
            </div>
            <p className="text-2xs text-gray-500 mt-3">
              Renews every 30 days. You can cancel from Subscription settings.
            </p>
            <button
              type="button"
              onClick={() => navigate('/subscription/payment')}
              className={`w-full mt-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                plan.code === 'ENTERPRISE'
                  ? 'bg-purple-600 hover:bg-purple-500 text-white'
                  : 'bg-amber-500 hover:bg-amber-400 text-black'
              }`}
            >
              Continue to payment
            </button>
          </div>
        </div>
      </div>
    </SubscriptionFlowShell>
  );
}
