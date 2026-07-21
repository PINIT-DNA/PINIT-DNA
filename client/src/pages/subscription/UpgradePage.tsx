import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Check, Sparkles, Shield, Zap, Building2, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { useSubscription } from '../../hooks/useSubscription';
import { useAuth } from '../../context/AuthContext';
import { markPlanChoiceComplete } from '../../lib/plan-onboarding';
import { saveCheckoutSession } from '../../lib/subscription/checkout-session';
import {
  FALLBACK_PLANS,
  PLAN_HIGHLIGHTS,
  formatStorage,
  type PlanDefinition,
} from '../../lib/subscription/plans';
import { PlanComparisonTable } from '../../components/subscription/PlanComparisonTable';
import { resolvePostUpgradePath } from '../../lib/subscription/post-upgrade-redirect';
import { plansForAccountType, isBusinessAccount } from '../../lib/account-type';
import { isValidAccountPlanCombination } from '../../lib/account-plan-rules';
import type { PlanCode } from '../../hooks/useSubscription';

export function UpgradePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { subscription, planCode, accountType, refresh } = useSubscription();
  const [plans, setPlans] = useState<PlanDefinition[]>(FALLBACK_PLANS);

  const fromLogin = searchParams.get('from') === 'login';
  const fromFeature = searchParams.get('from') === 'feature';
  const fromQuota = searchParams.get('from') === 'quota';
  const featureLabel = searchParams.get('label') ?? 'Investigation & Tracking';
  const feature = searchParams.get('feature') ?? undefined;
  const returnTo = searchParams.get('return') || '/';

  const resolvedAccountType = accountType ?? user?.accountType ?? 'INDIVIDUAL';
  const isBusiness = isBusinessAccount(resolvedAccountType);

  useEffect(() => {
    api.get<{ plans?: PlanDefinition[] }>(`${API_BASE_URL}/subscription/plans`)
      .then((r) => {
        const list = r.data?.plans ?? [];
        if (list.length) setPlans(list as PlanDefinition[]);
      })
      .catch(() => setPlans(FALLBACK_PLANS));
  }, []);

  const visiblePlans = useMemo(() => {
    const allowed = plansForAccountType(resolvedAccountType);
    return plans.filter((p) => allowed.includes(p.code) && isValidAccountPlanCombination(resolvedAccountType, p.code as PlanCode));
  }, [plans, resolvedAccountType]);

  function startCheckout(plan: PlanDefinition) {
    if (plan.code === 'FREE') {
      void continueWithFree();
      return;
    }
    saveCheckoutSession({
      planCode: plan.code as PlanCode,
      returnTo: resolvePostUpgradePath(plan.code as PlanCode, returnTo, resolvedAccountType),
      feature,
      featureLabel: fromFeature ? featureLabel : undefined,
      billingCycle: 'monthly',
    });
    navigate(`/subscription/checkout?plan=${plan.code}`);
  }

  async function continueWithFree() {
    try {
      if (planCode !== 'FREE') {
        await api.post(`${API_BASE_URL}/subscription/assign`, { planCode: 'FREE' });
        await refresh();
      }
      if (user?.sub) markPlanChoiceComplete(user.sub);
      toast.success('Continuing with Free plan — full access, 5 protected assets');
      navigate(resolvePostUpgradePath('FREE', returnTo, resolvedAccountType), { replace: true });
    } catch {
      toast.error('Could not update plan');
    }
  }

  const PlanIcon = ({ code }: { code: string }) => {
    if (code === 'PRO') return <Zap size={18} className="text-amber-400" />;
    if (code === 'ENTERPRISE') return <Building2 size={18} className="text-purple-400" />;
    return <Shield size={18} className="text-dna-400" />;
  };

  const headline = fromQuota
    ? 'Upgrade for unlimited protected assets'
    : fromLogin
      ? isBusiness
        ? 'Choose your organization plan'
        : 'Choose your protection plan'
      : fromFeature
        ? `Upgrade to unlock ${featureLabel}`
        : 'Upgrade your plan';

  const subline = fromQuota
    ? 'You have used all 5 protected assets on the Free plan. Existing assets stay accessible — upgrade for unlimited protection workflows.'
    : fromFeature
      ? `${featureLabel} requires a paid plan for extended usage beyond the free asset quota.`
      : isBusiness
        ? 'Free includes the complete business workflow (5 protected assets). Upgrade for team members and unlimited assets.'
        : 'Free includes the complete platform (5 protected assets). Upgrade for unlimited protected assets and higher storage.';

  const assetUsage = subscription?.assetLimit != null
    ? `${subscription.protectedAssetCount ?? 0} of ${subscription.assetLimit} protected assets used`
    : null;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-8 pb-12">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 text-dna-400 text-sm font-medium">
          <Sparkles size={16} /> PINITHub Plans
          {isBusiness && (
            <span className="text-2xs px-1.5 py-0.5 rounded border border-dna-500/30 text-dna-300">
              Business
            </span>
          )}
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{headline}</h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto">{subline}</p>
        <p className="text-sm">
          Current plan:{' '}
          <span className="font-semibold text-white">{subscription?.planName ?? 'Free'}</span>
          {assetUsage && planCode === 'FREE' && (
            <span className="text-gray-500"> · {assetUsage}</span>
          )}
          {' · '}
          <Link to="/subscription" className="text-dna-400 hover:underline">Manage subscription</Link>
        </p>
      </div>

      {fromQuota && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90 text-center">
          Asset quota reached. Upgrade to Pro{isBusiness ? ' or Enterprise' : ''} for unlimited protected assets.
        </div>
      )}

      <div className={`grid grid-cols-1 gap-4 ${visiblePlans.length === 2 ? 'md:grid-cols-2 max-w-3xl mx-auto' : 'md:grid-cols-3'}`}>
        {visiblePlans.map((plan) => {
          const current = plan.code === planCode;
          const highlights = PLAN_HIGHLIGHTS[plan.code] ?? [];
          const isPaid = plan.priceInr > 0;
          const featured = plan.code === 'PRO';

          return (
            <div
              key={plan.code}
              className={`rounded-2xl border p-5 flex flex-col transition-shadow hover:shadow-lg ${
                plan.code === 'ENTERPRISE'
                  ? 'border-purple-500/40 bg-purple-500/5'
                  : featured
                    ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/20'
                    : 'border-bg-border bg-bg-card'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <PlanIcon code={plan.code} />
                <h2 className="text-lg font-bold text-white">{plan.name}</h2>
                {featured && (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Popular
                  </span>
                )}
              </div>
              <p className="text-2xs text-gray-500 mt-1 mb-4">{plan.description}</p>

              <div className="mb-4">
                <p className="text-2xl font-bold text-white">
                  {isPaid ? (
                    <>₹{plan.priceInr}<span className="text-sm font-normal text-gray-500 ml-1">{plan.intervalLabel}</span></>
                  ) : (
                    '₹0'
                  )}
                </p>
                <p className="text-2xs text-gray-500 mt-1">
                  Storage: <span className="text-gray-300">{formatStorage(plan.storageLimitBytes)}</span>
                </p>
                {plan.assetLimit != null && (
                  <p className="text-2xs text-gray-500 mt-0.5">
                    Assets: <span className="text-gray-300">Up to {plan.assetLimit}</span>
                  </p>
                )}
                {plan.assetLimit == null && plan.code !== 'FREE' && (
                  <p className="text-2xs text-gray-500 mt-0.5">
                    Assets: <span className="text-gray-300">Unlimited</span>
                  </p>
                )}
              </div>

              <ul className="space-y-1.5 text-2xs text-gray-400 flex-1 mb-5">
                {highlights.map((label) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <Check size={12} className="text-emerald-400 shrink-0" />
                    {label}
                  </li>
                ))}
              </ul>

              {current && !(fromLogin && plan.code === 'FREE') ? (
                <span className="text-center text-xs text-gray-500 py-2.5 rounded-xl border border-bg-border">
                  Current plan
                </span>
              ) : isPaid ? (
                <button
                  type="button"
                  onClick={() => startCheckout(plan)}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                    plan.code === 'PRO'
                      ? 'bg-amber-500 hover:bg-amber-400 text-black'
                      : 'bg-purple-600 hover:bg-purple-500 text-white'
                  }`}
                >
                  Upgrade to {plan.name}
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void continueWithFree()}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-bg-elevated hover:bg-bg-border text-white border border-bg-border"
                >
                  {fromLogin ? 'Continue with Free' : 'Stay on Free'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-bold text-white text-center">Compare all features</h2>
        <PlanComparisonTable
          highlightPlan={fromQuota || fromFeature ? 'PRO' : undefined}
          showEnterprise={isBusiness}
        />
      </div>

      <p className="text-center text-2xs text-gray-500">
        Secure checkout · Cancel anytime · Mock payments enabled until live gateway is connected
      </p>
    </div>
  );
}
