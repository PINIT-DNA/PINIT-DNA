import { useNavigate, Link } from 'react-router-dom';
import { XCircle, RefreshCw, HelpCircle, CreditCard } from 'lucide-react';
import { SubscriptionFlowShell } from '../../components/subscription/SubscriptionFlowShell';

export function PaymentFailedPage() {
  const navigate = useNavigate();
  const errorMsg = sessionStorage.getItem('pinit_payment_error')
    ?? 'Your payment could not be processed. No charges were made.';

  function retry() {
    sessionStorage.removeItem('pinit_payment_error');
    navigate('/subscription/payment');
  }

  function simulateFailureRetry() {
    sessionStorage.removeItem('pinit_payment_error');
    navigate('/subscription/payment');
  }

  return (
    <SubscriptionFlowShell
      title="Payment failed"
      subtitle="Don't worry — your plan was not changed"
      backTo="/subscription/checkout"
      backLabel="Back to checkout"
    >
      <div className="max-w-md mx-auto text-center py-6">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/15 flex items-center justify-center">
          <XCircle size={36} className="text-red-400" />
        </div>

        <p className="text-sm text-gray-400 mb-6">{errorMsg}</p>

        <div className="rounded-xl border border-bg-border bg-bg-card p-4 text-left text-sm text-gray-400 mb-6">
          <p className="font-medium text-white mb-2">What you can try</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Check your payment details</li>
            <li>Try a different payment method</li>
            <li>Ensure sufficient balance</li>
          </ul>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={retry}
            className="w-full py-2.5 rounded-xl bg-dna-500 hover:bg-dna-600 text-white font-semibold text-sm flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} />
            Retry payment
          </button>
          <button
            type="button"
            onClick={() => navigate('/subscription/payment')}
            className="w-full py-2.5 rounded-xl border border-bg-border bg-bg-elevated text-white text-sm flex items-center justify-center gap-2"
          >
            <CreditCard size={16} />
            Choose different method
          </button>
          <Link
            to="/upgrade"
            className="block w-full py-2.5 text-sm text-gray-500 hover:text-gray-300"
          >
            Cancel and return to plans
          </Link>
          <a
            href="mailto:support@pinithub.com"
            className="inline-flex items-center gap-1 text-xs text-dna-400 hover:underline mt-4"
          >
            <HelpCircle size={14} />
            Contact support
          </a>
        </div>

        {import.meta.env.DEV && (
          <button
            type="button"
            onClick={simulateFailureRetry}
            className="mt-6 text-2xs text-gray-600 hover:text-gray-400"
          >
            Dev: test failure again
          </button>
        )}
      </div>
    </SubscriptionFlowShell>
  );
}
