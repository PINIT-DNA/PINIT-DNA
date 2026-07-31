import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoginFlow } from './LoginFlow';
import { RegistrationFlow } from './RegistrationFlow';
import { getPreRegisterAccountType } from '../../lib/pre-register';

function Booting() {
  return (
    <div className="pinit-auth" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
      <div className="pa-spin" style={{ width: 28, height: 28, border: '3px solid rgba(120,160,220,0.2)', borderTopColor: '#3b9eff', borderRadius: '50%' }} />
    </div>
  );
}

/** If already signed in, go straight to dashboard — stays in sync after login completes. */
export function PinitGateway() {
  const { user, loading } = useAuth();
  if (loading) return <Booting />;
  if (user) return <Navigate to="/" replace />;
  return <LoginFlow />;
}

export function RegisterGateway() {
  const { user, loading } = useAuth();
  if (loading) return <Booting />;
  if (user) return <Navigate to="/" replace />;
  if (!getPreRegisterAccountType()) {
    return <Navigate to="/register/account-type" replace />;
  }
  return <RegistrationFlow />;
}
