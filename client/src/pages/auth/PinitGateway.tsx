import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoginFlow } from './LoginFlow';
import { RegistrationFlow } from './RegistrationFlow';
import { getPreRegisterAccountType } from '../../lib/pre-register';
import { resolveExchangeReturn, stashExchangeReturn } from '../../lib/exchange-return';

function Booting() {
  return (
    <div className="pinit-auth" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
      <div className="pa-spin" style={{ width: 28, height: 28, border: '3px solid rgba(120,160,220,0.2)', borderTopColor: '#3b9eff', borderRadius: '50%' }} />
    </div>
  );
}

/**
 * Exchange SSO entry — always run Face/PAD/Passkey for exchange_return.
 * Leftover Hub JWT/refresh in localStorage must not skip biometrics.
 * Hub→Exchange while already inside Hub still uses openHubExchange / createExchangeSso.
 */
export function PinitGateway() {
  const { loading } = useAuth();
  const [searchParams] = useSearchParams();
  if (loading) return <Booting />;
  const er = resolveExchangeReturn(searchParams.get('exchange_return'));
  if (er) stashExchangeReturn(er);
  return <LoginFlow />;
}

export function RegisterGateway() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  if (loading) return <Booting />;

  const er = resolveExchangeReturn(searchParams.get('exchange_return'));
  if (er) stashExchangeReturn(er);

  // Existing Hub session + Exchange return → biometric login (never silent SSO).
  if (er && user) {
    return <Navigate to={`/login?exchange_return=${encodeURIComponent(er)}`} replace />;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  if (!getPreRegisterAccountType()) {
    const qs = er ? `?exchange_return=${encodeURIComponent(er)}` : '';
    return <Navigate to={`/register/account-type${qs}`} replace />;
  }
  return <RegistrationFlow />;
}
