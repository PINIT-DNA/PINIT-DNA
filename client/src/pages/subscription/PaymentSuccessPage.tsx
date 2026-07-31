import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { SubscriptionFlowShell } from '../../components/subscription/SubscriptionFlowShell';
import { UNLOCKED_FEATURES_BY_PLAN } from '../../lib/subscription/plans';
import { useSubscription } from '../../hooks/useSubscription';
import { useAuth } from '../../context/AuthContext';
import { setPendingUpgradeWelcome } from '../../lib/subscription/upgrade-welcome';
import { resolvePostUpgradePath } from '../../lib/subscription/post-upgrade-redirect';
import type { PlanCode } from '../../hooks/useSubscription';

interface LastPayment {
  transactionId: string;
  planCode: PlanCode;
  planName: string;
  amountInr: number;
  currentPeriodEnd: string;
  returnTo?: string;
}

export function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { refresh, subscription } = useSubscription();
  const [payment, setPayment] = useState<LastPayment | null>(null);

  const txn = searchParams.get('txn');
  const planParam = searchParams.get('plan') as PlanCode | null;

  useEffect(() => {
    void refresh();
    try {
      const raw = sessionStorage.getItem('pinit_last_payment');
      if (raw) {
        const parsed = JSON.parse(raw) as LastPayment;
        setPayment(parsed);
        if (user?.sub && parsed.planCode) {
          setPendingUpgradeWelcome(user.sub, parsed.planCode);
        }
      } else if (txn && planParam) {
        setPayment({
          transactionId: txn,
          planCode: planParam,
          planName: planParam === 'ENTERPRISE' ? 'Enterprise' : 'Pro',
          amountInr: planParam === 'ENTERPRISE' ? 4999 : 999,
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
      }
    } catch { /* ignore */ }
  }, [refresh, txn, planParam, user?.sub]);

  const planCode = payment?.planCode ?? planParam ?? 'PRO';
  const features = UNLOCKED_FEATURES_BY_PLAN[planCode] ?? [];
  const returnTo = resolvePostUpgradePath(
    planCode,
    payment?.returnTo,
    subscription?.accountType ?? user?.accountType,
  );
  const isEnterprise = planCode === 'ENTERPRISE';

  function handleContinue() {
    sessionStorage.removeItem('pinit_last_payment');
    navigate(returnTo, { replace: true });
  }

  return (
    <SubscriptionFlowShell
      title=""
      step={{ current: 3, total: 3, label: 'Complete' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-lg mx-auto text-center py-8"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.1 }}
          className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-500/15 flex items-center justify-center"
        >
          <CheckCircle2 size={40} className="text-emerald-400" />
        </motion.div>

        <div className="inline-flex items-center gap-2 text-emerald-400 text-sm font-medium mb-2">
          <Sparkles size={14} /> Payment successful
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Plan activated</h1>
        <p className="text-gray-400 text-sm mb-8">
          Welcome to PINITHub {payment?.planName ?? subscription?.planName ?? planCode}. Your premium features are unlocked.
        </p>

        <div className="rounded-2xl border border-bg-border bg-bg-card p-5 text-left mb-6 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Transaction ID</span>
            <span className="font-mono text-xs text-white">{payment?.transactionId ?? txn ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Plan</span>
            <span className="text-white font-medium">{payment?.planName ?? subscription?.planName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Amount paid</span>
            <span className="text-white">₹{payment?.amountInr ?? '—'}</span>
          </div>
          {payment?.currentPeriodEnd && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Valid until</span>
              <span className="text-white">{new Date(payment.currentPeriodEnd).toLocaleDateString()}</span>
            </div>
          )}
        </div>

        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 text-left">Activated features</p>
        <ul className="text-left space-y-2 mb-8">
          {features.slice(0, 6).map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              {f}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={handleContinue}
          className={`w-full py-3 rounded-xl font-semibold text-sm mb-3 ${
            isEnterprise
              ? 'bg-purple-600 hover:bg-purple-500 text-white'
              : 'bg-dna-500 hover:bg-dna-600 text-white'
          }`}
        >
          {isEnterprise ? 'Continue to Enterprise dashboard' : 'Continue to dashboard'}
        </button>
        <Link to="/subscription" className="text-sm text-dna-400 hover:underline">
          View subscription details
        </Link>
      </motion.div>
    </SubscriptionFlowShell>
  );
}
