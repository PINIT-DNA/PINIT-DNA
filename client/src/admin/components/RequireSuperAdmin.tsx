import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { isPlatformOwnerShortId } from '../../lib/platform-owner';

/**
 * Only the platform-owner PinIT ID may access /admin/*.
 * Role SUPER_ADMIN alone is not enough — shortId must be allowlisted.
 */
export function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setChecking(false);
      setAllowed(false);
      return;
    }

    const jwtShortId = (user as { shortId?: string }).shortId;
    if (isPlatformOwnerShortId(jwtShortId) && user.role === 'SUPER_ADMIN') {
      setAllowed(true);
      setChecking(false);
      return;
    }

    void (async () => {
      try {
        const res = await api.get(`${API_BASE_URL}/profile`);
        const profile = (res.data as { profile?: { role?: string; shortId?: string } }).profile;
        setAllowed(
          profile?.role === 'SUPER_ADMIN' && isPlatformOwnerShortId(profile?.shortId ?? jwtShortId),
        );
      } catch {
        setAllowed(false);
      } finally {
        setChecking(false);
      }
    })();
  }, [loading, user]);

  if (loading || checking) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
