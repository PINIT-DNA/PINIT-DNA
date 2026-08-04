import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { DashboardPage } from '../../pages/DashboardPage';
import { BUSINESS_DASHBOARD_PATH } from '../../lib/subscription/post-upgrade-redirect';
import { useAccountViewMode } from '../../context/AccountViewModeContext';
import { getAccountViewMode } from '../../lib/account-view-mode';

/**
 * Home `/` — personal forensic dashboard unless Business shell is active.
 */
export function HomeRedirect() {
  const { user, loading: authLoading } = useAuth();
  const { isBusinessShell } = useAccountViewMode();

  const prefersBusiness =
    Boolean(user?.sub) &&
    getAccountViewMode(user?.sub, user?.accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL') === 'BUSINESS';

  if (authLoading) {
    return null;
  }

  if (prefersBusiness || isBusinessShell) {
    return <Navigate to={BUSINESS_DASHBOARD_PATH} replace />;
  }

  return <DashboardPage />;
}
