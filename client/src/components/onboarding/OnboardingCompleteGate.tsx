import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  hasCompletedAccountTypeOnboarding,
  resolveEffectiveAccountType,
} from '../../lib/account-onboarding';
import { resolveFullyOnboardedHome } from '../../lib/onboarding-routes';

/** If account-type onboarding is done, leave the isolated shell. */
export function OnboardingCompleteGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Outlet />;
  }

  if (hasCompletedAccountTypeOnboarding(user.sub)) {
    const accountType = resolveEffectiveAccountType(user.sub, user.accountType);
    return <Navigate to={resolveFullyOnboardedHome(accountType)} replace />;
  }

  return <Outlet />;
}
