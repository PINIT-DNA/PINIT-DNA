import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';

/**
 * Only SUPER_ADMIN may access /admin/*.
 * Role is verified from the server (not stale JWT) so promotions work without re-login.
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

    // Fast path: JWT already has SUPER_ADMIN
    if (user.role === 'SUPER_ADMIN') {
      setAllowed(true);
      setChecking(false);
      return;
    }

    // Verify live role from database (handles role changes without re-login)
    void (async () => {
      try {
        const res = await api.get(`${API_BASE_URL}/profile`);
        const role = (res.data as { profile?: { role?: string } }).profile?.role;
        setAllowed(role === 'SUPER_ADMIN');
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
