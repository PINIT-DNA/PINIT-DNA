import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import { DashboardPage } from '../../pages/DashboardPage';
import { BUSINESS_DASHBOARD_PATH } from '../../lib/subscription/post-upgrade-redirect';

/**
 * Home route — routes by account type ONLY.
 * Subscription plan (Free/Pro/Enterprise) never changes which dashboard shell opens.
 */
export function HomeRedirect() {
  const { user } = useAuth();
  const { accountType, loading } = useSubscription();

  const resolved = user?.accountType ?? accountType ?? 'INDIVIDUAL';

  if (loading && !user?.accountType) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (resolved === 'BUSINESS') {
    return <Navigate to={BUSINESS_DASHBOARD_PATH} replace />;
  }

  return <DashboardPage />;
}
