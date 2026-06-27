import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoginFlow } from './LoginFlow';
import { RegistrationFlow } from './RegistrationFlow';

function Booting() {
  return (
    <div className="pinit-auth" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="pa-spin" style={{ width: 28, height: 28, border: '3px solid #e3e7f1', borderTopColor: '#6366f1', borderRadius: '50%' }} />
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
  return <RegistrationFlow />;
}
