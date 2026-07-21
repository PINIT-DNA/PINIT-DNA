import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { OnboardingLayout } from '../../layouts/OnboardingLayout';

function Booting() {
  return (
    <div className="pinit-auth" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex', minHeight: '100dvh' }}>
      <div className="pa-spin" style={{ width: 28, height: 28, border: '3px solid rgba(120,160,220,0.2)', borderTopColor: '#3b9eff', borderRadius: '50%' }} />
    </div>
  );
}

/** Auth guard + layout shell for public pre-registration account type selection. */
export function PreRegisterRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Booting />;
  if (user) return <Navigate to="/" replace />;
  return <OnboardingLayout publicMode />;
}
