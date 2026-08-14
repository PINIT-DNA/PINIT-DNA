import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoginFlow } from './LoginFlow';
import { RegistrationFlow } from './RegistrationFlow';
import { getPreRegisterAccountType } from '../../lib/pre-register';
import { resolveExchangeReturn, stashExchangeReturn } from '../../lib/exchange-return';
import { ExchangeReturnHandoff } from '../../components/auth/ExchangeReturnHandoff';
import { hasHubSession } from '../../lib/auth';

function Booting() {
  return (
    <div className="pinit-auth" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
      <div className="pa-spin" style={{ width: 28, height: 28, border: '3px solid rgba(120,160,220,0.2)', borderTopColor: '#3b9eff', borderRadius: '50%' }} />
    </div>
  );
}

/**
 * Exchange SSO entry — if Hub JWT exists on this origin, mint SSO and return to Exchange.
 * Otherwise face login (never register from /login).
 */
export function PinitGateway() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  if (loading) return <Booting />;
  const er = resolveExchangeReturn(searchParams.get('exchange_return'));
  if (er) stashExchangeReturn(er);
  const sessionActive = Boolean(user) || hasHubSession();
  if (sessionActive && er) {
    return <ExchangeReturnHandoff fallback={<LoginFlow />} />;
  }
  return <LoginFlow />;
}

export function RegisterGateway() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  if (loading) return <Booting />;

  const er = resolveExchangeReturn(searchParams.get('exchange_return'));
  if (er) stashExchangeReturn(er);

  const sessionActive = Boolean(user) || hasHubSession();
  if (sessionActive && er) {
    return <ExchangeReturnHandoff fallback={<Navigate to="/" replace />} />;
  }
  if (sessionActive) {
    return <Navigate to="/" replace />;
  }

  if (!getPreRegisterAccountType()) {
    const qs = er ? `?exchange_return=${encodeURIComponent(er)}` : '';
    return <Navigate to={`/register/account-type${qs}`} replace />;
  }
  return <RegistrationFlow />;
}
