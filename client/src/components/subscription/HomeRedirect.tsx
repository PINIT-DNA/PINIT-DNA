import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import { DashboardPage } from '../../pages/DashboardPage';
import { BUSINESS_DASHBOARD_PATH } from '../../lib/subscription/post-upgrade-redirect';
import { useAccountViewMode } from '../../context/AccountViewModeContext';
import { getAccountViewMode } from '../../lib/account-view-mode';

/**
 * Home `/` — personal forensic dashboard unless Business shell is active.
 */
export function HomeRedirect() {
  const { user, loading: authLoading } = useAuth();
  const { loading: subscriptionLoading } = useSubscription();
  const { isBusinessShell, hasBusinessAccess } = useAccountViewMode();

  const prefersBusiness =
    Boolean(user?.sub) &&
    getAccountViewMode(user?.sub, user?.accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL') === 'BUSINESS';

  // Wait while auth/subscription settle so we don't flash Individual over Business
  if (
    authLoading ||
    (subscriptionLoading && user?.accountType !== 'BUSINESS') ||
    (prefersBusiness && hasBusinessAccess && !isBusinessShell)
  ) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isBusinessShell) {
    return <Navigate to={BUSINESS_DASHBOARD_PATH} replace />;
  }

  return <DashboardPage />;
}
