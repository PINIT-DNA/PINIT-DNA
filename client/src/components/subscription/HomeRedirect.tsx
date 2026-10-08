import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { DashboardPage } from '../../pages/DashboardPage';
import { BUSINESS_DASHBOARD_PATH } from '../../lib/subscription/post-upgrade-redirect';
import { useAccountViewMode } from '../../context/AccountViewModeContext';

/**
 * Home `/` — personal forensic dashboard unless lastActiveShell / this session is Business.
 * Super-admins are not auto-sent to `/admin` so they can still use Hub.
 */
export function HomeRedirect() {
  const { loading: authLoading } = useAuth();
  const { isBusinessShell } = useAccountViewMode();

  if (authLoading) {
    return null;
  }

  if (isBusinessShell) {
    return <Navigate to={BUSINESS_DASHBOARD_PATH} replace />;
  }

  return <DashboardPage />;
}
