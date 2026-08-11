import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, User, ArrowRight } from 'lucide-react';
import type { AccountType } from '../../lib/account-type';
import { setPreRegisterAccountType } from '../../lib/pre-register';
import {
  resolveExchangeReturn,
  stashExchangeReturn,
} from '../../lib/exchange-return';

function cardClass(selected: boolean, variant: 'individual' | 'business'): string {
  const base = 'ob-type-card text-left rounded-2xl border p-6 transition-all w-full';
  if (!selected) return base;
  return `${base} ${variant === 'business' ? 'ob-selected-business' : 'ob-selected-individual'}`;
}

/** Public step before biometric registration — choose account type first. */
export function PreRegisterAccountTypePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hint = searchParams.get('hint');
  const [type, setType] = useState<AccountType>(
    hint === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
  );

  const exchangeReturn = resolveExchangeReturn(searchParams.get('exchange_return'));

  useEffect(() => {
    if (exchangeReturn) stashExchangeReturn(exchangeReturn);
  }, [exchangeReturn]);

  function handleContinue() {
    setPreRegisterAccountType(type);
    const qs = exchangeReturn
      ? `?exchange_return=${encodeURIComponent(exchangeReturn)}`
      : '';
    navigate(`/register${qs}`, { replace: true });
  }

  const fromExchange = Boolean(exchangeReturn);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-8 pb-16">
      <div className="text-center space-y-2 max-w-3xl mx-auto">
        <h1 className="ob-heading text-2xl sm:text-3xl font-bold">Choose your account type</h1>
        <p className="ob-subtext text-sm max-w-lg mx-auto">
          {fromExchange
            ? 'Create your Pinit HUB identity to sell on Pinit Exchange. Pick Individual or Business.'
            : 'Pick how you will use Pinit HUB. You start on the Free plan — upgrade anytime.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setType('INDIVIDUAL')}
          className={cardClass(type === 'INDIVIDUAL', 'individual')}
          aria-pressed={type === 'INDIVIDUAL'}
        >
          <User size={28} className="text-dna-400 mb-3" />
          <h2 className="text-lg font-bold mb-1">Individual Account</h2>
          <p className="text-xs ob-muted mb-3">
            Personal ownership and protection of digital assets.
          </p>
          <p className="text-2xs ob-faint leading-relaxed">
            Choose Individual → Register → Personal Dashboard
          </p>
        </button>

        <button
          type="button"
          onClick={() => setType('BUSINESS')}
          className={cardClass(type === 'BUSINESS', 'business')}
          aria-pressed={type === 'BUSINESS'}
        >
          <Building2 size={28} className="text-purple-400 mb-3" />
          <h2 className="text-lg font-bold mb-1">Business Account</h2>
          <p className="text-xs ob-muted mb-3">
            Organization-level management — workspace, shared vault, and team (upgrade to grow).
          </p>
          <p className="text-2xs ob-faint leading-relaxed">
            Choose Business → Register → Business Dashboard
          </p>
        </button>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={handleContinue}
          className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white text-sm font-semibold ${
            type === 'BUSINESS'
              ? 'bg-purple-600 hover:bg-purple-500'
              : 'bg-dna-600 hover:bg-dna-500'
          }`}
        >
          {type === 'BUSINESS' ? 'Continue to registration' : 'Continue as Individual'}
          <ArrowRight size={16} />
        </button>
        <Link
          to={exchangeReturn ? `/login?exchange_return=${encodeURIComponent(exchangeReturn)}` : '/login'}
          className="text-xs ob-faint hover:text-dna-400 transition-colors"
        >
          Already have an account? Sign in
        </Link>
      </div>
    </div>
  );
}
