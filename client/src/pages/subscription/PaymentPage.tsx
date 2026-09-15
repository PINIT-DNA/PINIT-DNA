import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, Smartphone, Building, Wallet, QrCode,
  Shield, Loader2, CheckCircle2,
} from 'lucide-react';
import { SubscriptionFlowShell } from '../../components/subscription/SubscriptionFlowShell';
import { loadCheckoutSession, updateCheckoutSession, clearCheckoutSession } from '../../lib/subscription/checkout-session';
import { getPlan, FALLBACK_PLANS } from '../../lib/subscription/plans';
import { fetchBillingConfig, resolvePaymentProvider, mockPaymentProvider } from '../../lib/subscription/payment-provider';
import { invalidateSubscriptionCache } from '../../hooks/useSubscription';
import { markPlanChoiceComplete } from '../../lib/plan-onboarding';
import { setPendingUpgradeWelcome } from '../../lib/subscription/upgrade-welcome';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../components/ui/utils';

type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet' | 'qr';
type Phase = 'form' | 'processing' | 'verifying';

const METHODS: Array<{ id: PaymentMethod; label: string; icon: React.ReactNode; hint: string }> = [
  { id: 'upi', label: 'UPI', icon: <Smartphone size={18} />, hint: 'GPay, PhonePe, Paytm' },
  { id: 'card', label: 'Card', icon: <CreditCard size={18} />, hint: 'Visa, Mastercard, RuPay' },
  { id: 'netbanking', label: 'Net Banking', icon: <Building size={18} />, hint: 'All major banks' },
  { id: 'wallet', label: 'Wallet', icon: <Wallet size={18} />, hint: 'Paytm, Amazon Pay' },
  { id: 'qr', label: 'QR Code', icon: <QrCode size={18} />, hint: 'Scan & pay' },
];

const PROCESS_STEPS = [
  'Processing payment…',
  'Verifying transaction…',
  'Activating your plan…',
];

export function PaymentPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const session = loadCheckoutSession();
  const plan = getPlan(session?.planCode ?? null, FALLBACK_PLANS);

  const [method, setMethod] = useState<PaymentMethod>('card');
  const [coupon, setCoupon] = useState('');
  const [terms, setTerms] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [processStep, setProcessStep] = useState(0);
  const [savedCard] = useState(true);
  const [useRazorpay, setUseRazorpay] = useState<boolean | null>(null);
  const [mockAllowed, setMockAllowed] = useState(false);

  useEffect(() => {
    if (!session?.planCode || !plan) {
      navigate('/upgrade', { replace: true });
    }
  }, [session, plan, navigate]);

  useEffect(() => {
    void fetchBillingConfig().then((cfg) => {
      setUseRazorpay(cfg.configured);
      setMockAllowed(cfg.mockAllowed);
    });
  }, []);

  if (!session || !plan) return null;

  async function handlePay(simulateFailure = false, forceMock = false) {
    if (!terms || !session) return;

    const provider = forceMock ? mockPaymentProvider : await resolvePaymentProvider();
    const isRazorpay = provider.id === 'razorpay';

    let stepTimer: ReturnType<typeof setInterval> | undefined;
    if (!isRazorpay) {
      setPhase('processing');
      setProcessStep(0);
      stepTimer = setInterval(() => {
        setProcessStep((s) => Math.min(s + 1, PROCESS_STEPS.length - 1));
      }, 900);
      await delay(1200);
      setPhase('verifying');
      setProcessStep(2);
    }

    try {
      updateCheckoutSession({
        paymentMethod: isRazorpay ? 'razorpay' : method,
        coupon: isRazorpay ? undefined : coupon || undefined,
        simulateFailure: isRazorpay ? undefined : simulateFailure,
      });

      const simulateFail = !isRazorpay && (coupon.toUpperCase() === 'FAILTEST' || simulateFailure);
      const result = await provider.completePayment({
        planCode: session.planCode,
        paymentMethod: isRazorpay ? 'razorpay' : method,
        coupon: isRazorpay ? undefined : coupon || undefined,
        simulateFailure: simulateFail,
        userName: user?.name,
        onCheckoutOpen: () => {
          setPhase('processing');
          setProcessStep(0);
        },
        onVerifying: () => {
          setPhase('verifying');
          setProcessStep(2);
        },
      });
      if (stepTimer) clearInterval(stepTimer);
      invalidateSubscriptionCache();

      if (user?.sub) {
        markPlanChoiceComplete(user.sub);
        setPendingUpgradeWelcome(user.sub, session.planCode);
      }

      sessionStorage.setItem(
        'pinit_last_payment',
        JSON.stringify({ ...result, returnTo: session.returnTo }),
      );

      clearCheckoutSession();
      await delay(800);

      navigate(
        `/subscription/success?txn=${encodeURIComponent(result.transactionId)}&plan=${result.planCode}`,
        { replace: true },
      );
    } catch (err) {
      if (stepTimer) clearInterval(stepTimer);
      setPhase('form');
      const message = err instanceof Error ? err.message : 'Payment failed';
      sessionStorage.setItem('pinit_payment_error', message);
      navigate('/subscription/failed', { replace: true });
    }
  }

  const discount = coupon.toUpperCase() === 'PINIT10' ? Math.round(plan.priceInr * 0.1) : 0;
  const total = plan.priceInr - discount;

  return (
    <>
      <SubscriptionFlowShell
        title="Complete payment"
        subtitle={`Pinit HUB ${plan.name} · ₹${total}/month`}
        step={{ current: 2, total: 3, label: 'Payment' }}
        backTo="/subscription/checkout"
        backLabel="Back to checkout"
      >
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-4">
            {useRazorpay && (
              <div className="rounded-xl border border-dna-500/30 bg-dna-500/5 p-4">
                <p className="text-sm font-medium text-white mb-1">Secure payment via Razorpay</p>
                <p className="text-xs text-gray-400">
                  UPI, cards, net banking, and wallets are available in the Razorpay checkout window.
                </p>
              </div>
            )}

            {!useRazorpay && savedCard && (
              <div className="rounded-xl border border-dna-500/30 bg-dna-500/5 p-4">
                <p className="text-2xs font-semibold text-gray-500 uppercase mb-2">Saved method</p>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="radio" name="saved" defaultChecked className="accent-dna-500" />
                  <CreditCard size={18} className="text-dna-400" />
                  <span className="text-sm text-white">•••• •••• •••• 4242</span>
                  <span className="text-2xs text-gray-500 ml-auto">Visa</span>
                </label>
              </div>
            )}

            {!useRazorpay && (
            <div>
              <p className="text-2xs font-semibold text-gray-500 uppercase mb-3">Payment method</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all',
                      method === m.id
                        ? 'border-dna-500 bg-dna-500/10 ring-1 ring-dna-500/30'
                        : 'border-bg-border bg-bg-card hover:border-bg-border/80',
                    )}
                  >
                    <div className="text-dna-400 mb-1">{m.icon}</div>
                    <p className="text-sm font-medium text-white">{m.label}</p>
                    <p className="text-2xs text-gray-500">{m.hint}</p>
                  </button>
                ))}
              </div>
            </div>
            )}

            {!useRazorpay && method === 'card' && (
              <div className="rounded-xl border border-bg-border bg-bg-card p-4 space-y-3">
                <input className="form-input w-full bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 text-sm text-white" placeholder="Card number" defaultValue="4111 1111 1111 1111" />
                <div className="grid grid-cols-2 gap-3">
                  <input className="bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 text-sm text-white" placeholder="MM / YY" defaultValue="12 / 28" />
                  <input className="bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 text-sm text-white" placeholder="CVV" defaultValue="123" />
                </div>
              </div>
            )}

            {!useRazorpay && method === 'upi' && (
              <div className="rounded-xl border border-bg-border bg-bg-card p-4">
                <input className="w-full bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 text-sm text-white" placeholder="yourname@upi" defaultValue="priya@okaxis" />
              </div>
            )}

            {!useRazorpay && method === 'qr' && (
              <div className="rounded-xl border border-bg-border bg-bg-card p-6 flex flex-col items-center">
                <div className="w-40 h-40 bg-white rounded-lg flex items-center justify-center text-gray-400 text-xs">
                  QR Code
                </div>
                <p className="text-xs text-gray-500 mt-3">Scan with any UPI app</p>
              </div>
            )}

            {!useRazorpay && (
            <div className="rounded-xl border border-bg-border bg-bg-card p-4">
              <label className="text-2xs font-semibold text-gray-500 uppercase">Coupon code</label>
              <div className="flex gap-2 mt-2">
                <input
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value)}
                  className="flex-1 bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="Enter code (try PINIT10)"
                />
              </div>
            </div>
            )}

            <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 accent-dna-500" />
              <span>
                I agree to the Terms of Service and authorize Pinit HUB to charge ₹{total} monthly until I cancel.
              </span>
            </label>
          </div>

          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-bg-border bg-bg-card p-5 sticky top-4">
              <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                <Shield size={16} className="text-emerald-400" />
                Billing summary
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-400">
                  <span>{plan.name} (monthly)</span>
                  <span>₹{plan.priceInr}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Coupon {coupon.toUpperCase()}</span>
                    <span>-₹{discount}</span>
                  </div>
                )}
                <div className="border-t border-bg-border pt-2 flex justify-between font-bold text-white text-base">
                  <span>Total</span>
                  <span>₹{total}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={!terms || phase !== 'form'}
                onClick={() => void handlePay()}
                className={cn(
                  'w-full mt-5 py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50',
                  plan.code === 'ENTERPRISE'
                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-black',
                )}
              >
                {useRazorpay ? `Pay with Razorpay · ₹${total}` : `Proceed to pay ₹${total}`}
              </button>
              {useRazorpay && mockAllowed && (
                <button
                  type="button"
                  disabled={!terms || phase !== 'form'}
                  onClick={() => void handlePay(false, true)}
                  className="w-full mt-2 py-2.5 rounded-xl text-xs font-semibold border border-dashed border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                >
                  🧪 Simulate successful payment (dev/test only)
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate('/upgrade')}
                className="w-full mt-2 py-2 text-xs text-gray-500 hover:text-gray-300"
              >
                Cancel payment
              </button>
              {useRazorpay === false && (
                <p className="text-2xs text-gray-600 mt-3 text-center">
                  Mock payment — no real charge. Add Razorpay keys for live checkout.
                </p>
              )}
              {useRazorpay && (
                <p className="text-2xs text-gray-600 mt-3 text-center">
                  Payments are processed securely by Razorpay.
                  {mockAllowed && ' The simulate button skips checkout entirely — dev-only, unavailable in production.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </SubscriptionFlowShell>

      <AnimatePresence>
        {(phase === 'processing' || phase === 'verifying') && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-bg-base/95 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="max-w-sm w-full text-center"
            >
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-dna-500/15 flex items-center justify-center">
                <Loader2 size={32} className="text-dna-400 animate-spin" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">{PROCESS_STEPS[processStep]}</h2>
              <p className="text-sm text-gray-400 mb-6">Please don&apos;t close this window</p>
              <div className="space-y-2">
                {PROCESS_STEPS.map((step, i) => (
                  <div
                    key={step}
                    className={cn(
                      'flex items-center gap-2 text-sm',
                      i <= processStep ? 'text-white' : 'text-gray-600',
                    )}
                  >
                    {i < processStep ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : i === processStep ? (
                      <Loader2 size={16} className="animate-spin text-dna-400" />
                    ) : (
                      <span className="w-4 h-4 rounded-full border border-gray-600" />
                    )}
                    {step}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
