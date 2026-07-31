import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, User, ArrowRight, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { useAuth } from '../../context/AuthContext';
import {
  clearBusinessSetup,
  markAccountTypeOnboardingComplete,
  setChosenAccountType,
} from '../../lib/account-onboarding';
import { resolvePostAccountTypePath } from '../../lib/onboarding-routes';
import { invalidateSubscriptionCache, useSubscription } from '../../hooks/useSubscription';
import { saveTokens } from '../../lib/auth';
import type { AccountType } from '../../lib/account-type';
import {
  INDIVIDUAL_PLAN_ADJUST_MSG,
  isValidAccountPlanCombination,
} from '../../lib/account-plan-rules';

function cardClass(selected: boolean, variant: 'individual' | 'business'): string {
  const base = 'ob-type-card text-left rounded-2xl border p-6 transition-all w-full';
  if (!selected) return base;
  return `${base} ${variant === 'business' ? 'ob-selected-business' : 'ob-selected-individual'}`;
}

export function AccountTypeOnboardingPage() {
  const navigate = useNavigate();
  const { user, loginWithFaceResponse } = useAuth();
  const { subscription, planCode } = useSubscription();
  const [type, setType] = useState<AccountType>('INDIVIDUAL');
  const [busy, setBusy] = useState(false);
  const [blockingError, setBlockingError] = useState<string | null>(null);

  const currentPlan = planCode ?? subscription?.planCode ?? 'FREE';
  const individualNeedsPlanAdjust = !isValidAccountPlanCombination('INDIVIDUAL', currentPlan);

  function selectAccountType(next: AccountType) {
    setType(next);
    setBlockingError(null);
    if (user?.sub) setChosenAccountType(user.sub, next);
  }

  async function handleContinue() {
    if (!user?.sub) return;
    setBlockingError(null);
    setBusy(true);
    try {
      const { data } = await api.post<{
        success?: boolean;
        error?: string;
        accessToken?: string;
        refreshToken?: string;
        accountType?: AccountType;
        planAdjusted?: boolean;
        planCode?: string;
      }>(`${API_BASE_URL}/auth/account-type`, { accountType: type });

      const resolvedType = data.accountType ?? type;
      setChosenAccountType(user.sub, resolvedType);

      if (data.accessToken) {
        saveTokens(data.accessToken, data.refreshToken ?? '');
        loginWithFaceResponse({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      }

      markAccountTypeOnboardingComplete(user.sub);
      if (resolvedType === 'BUSINESS') {
        clearBusinessSetup(user.sub);
      }

      invalidateSubscriptionCache();
      if (data.planAdjusted) {
        toast.success('Individual account configured — subscription set to Free');
      } else {
        toast.success(
          resolvedType === 'BUSINESS'
            ? 'Business account selected — your organization dashboard is ready'
            : 'Individual account configured',
        );
      }
      navigate(resolvePostAccountTypePath(resolvedType), { replace: true });
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error as string | undefined;
      const text = msg ?? 'Could not save account type';
      setBlockingError(text);
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-8 pb-16">
      <div className="text-center space-y-2 max-w-3xl mx-auto">
        <h1 className="ob-heading text-2xl sm:text-3xl font-bold">Choose your account type</h1>
        <p className="ob-subtext text-sm max-w-lg mx-auto">
          Account type defines who you are. Your subscription ({subscription?.planName ?? 'Free'})
          {individualNeedsPlanAdjust && type === 'INDIVIDUAL'
            ? ' will switch to Free if you choose Individual.'
            : ' stays unchanged.'}
        </p>
      </div>

      {individualNeedsPlanAdjust && type === 'INDIVIDUAL' && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-100/90 flex gap-3">
          <Info size={18} className="shrink-0 mt-0.5" />
          <span>{INDIVIDUAL_PLAN_ADJUST_MSG}</span>
        </div>
      )}

      {blockingError && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200/90">
          {blockingError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => selectAccountType('INDIVIDUAL')}
          className={cardClass(type === 'INDIVIDUAL', 'individual')}
          aria-pressed={type === 'INDIVIDUAL'}
        >
          <User size={28} className="text-dna-400 mb-3" />
          <h2 className="text-lg font-bold mb-1">Individual Account</h2>
          <p className="text-xs ob-muted mb-3">
            Personal ownership and protection of digital assets.
          </p>
          <p className="text-2xs ob-faint leading-relaxed">
            Choose Individual → Personal Dashboard
          </p>
        </button>

        <button
          type="button"
          onClick={() => selectAccountType('BUSINESS')}
          className={cardClass(type === 'BUSINESS', 'business')}
          aria-pressed={type === 'BUSINESS'}
        >
          <Building2 size={28} className="text-purple-400 mb-3" />
          <h2 className="text-lg font-bold mb-1">Business Account</h2>
          <p className="text-xs ob-muted mb-3">
            Organization-level management — workspace, shared vault, and team (upgrade to grow).
          </p>
          <p className="text-2xs ob-faint leading-relaxed">
            Choose Business → Organization setup → Business Dashboard
          </p>
        </button>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleContinue()}
          className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl disabled:opacity-60 text-white text-sm font-semibold ${
            type === 'BUSINESS'
              ? 'bg-purple-600 hover:bg-purple-500'
              : 'bg-dna-600 hover:bg-dna-500'
          }`}
        >
          {type === 'BUSINESS' ? 'Continue to registration' : 'Continue as Individual'}
          <ArrowRight size={16} />
        </button>
        <p className="text-2xs ob-faint">Free plan assigned at registration · Upgrade anytime</p>
      </div>
    </div>
  );
}
