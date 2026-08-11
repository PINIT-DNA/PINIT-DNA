import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoginFlow } from './LoginFlow';
import { RegistrationFlow } from './RegistrationFlow';
import { getPreRegisterAccountType } from '../../lib/pre-register';
import { ExchangeReturnHandoff } from '../../components/auth/ExchangeReturnHandoff';
import { resolveExchangeReturn, stashExchangeReturn } from '../../lib/exchange-return';

function Booting() {
  return (
    <div className="pinit-auth" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
      <div className="pa-spin" style={{ width: 28, height: 28, border: '3px solid rgba(120,160,220,0.2)', borderTopColor: '#3b9eff', borderRadius: '50%' }} />
    </div>
  );
}

/** If already signed in, go straight to dashboard — or Exchange if exchange_return is set. */
export function PinitGateway() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  if (loading) return <Booting />;
  if (user) {
    const er = resolveExchangeReturn(searchParams.get('exchange_return'));
    if (er) stashExchangeReturn(er);
    return (
      <ExchangeReturnHandoff fallback={<Navigate to="/" replace />} />
    );
  }
  return <LoginFlow />;
}

export function RegisterGateway() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  if (loading) return <Booting />;

  const er = resolveExchangeReturn(searchParams.get('exchange_return'));
  if (er) stashExchangeReturn(er);

  if (user) {
    return <ExchangeReturnHandoff fallback={<Navigate to="/" replace />} />;
  }
  if (!getPreRegisterAccountType()) {
    const qs = er ? `?exchange_return=${encodeURIComponent(er)}` : '';
    return <Navigate to={`/register/account-type${qs}`} replace />;
  }
  return <RegistrationFlow />;
}
