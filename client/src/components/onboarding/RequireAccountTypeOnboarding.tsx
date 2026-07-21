import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { hasCompletedAccountTypeOnboarding } from '../../lib/account-onboarding';
import { ACCOUNT_TYPE_ONBOARDING_PATH } from '../../lib/onboarding-routes';

/**
 * Wraps DashboardLayout — redirects to account-type onboarding until complete.
 * Business org setup is optional and happens inside the dashboard.
 */
export function RequireAccountTypeOnboarding({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg-base">
        <div className="w-6 h-6 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user && !hasCompletedAccountTypeOnboarding(user.sub)) {
    return (
      <Navigate
        to={ACCOUNT_TYPE_ONBOARDING_PATH}
        replace
        state={{ returnTo: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <>{children}</>;
}
