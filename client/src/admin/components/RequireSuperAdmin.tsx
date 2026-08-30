import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { fetchMyCapabilities } from '../api/super-admin.api';
import type { MyCapabilities } from '../api/super-admin.api';
import { AdminCapabilitiesProvider } from '../context/AdminCapabilitiesContext';

/**
 * Any of the five UserRole values may enter /admin/* as long as their
 * capability map grants at least one read domain (Phase 2 RBAC). Destructive
 * actions remain separately gated server-side behind the platform-owner
 * shortId allowlist regardless of what this check allows in.
 */
export function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [caps, setCaps] = useState<MyCapabilities | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setChecking(false);
      return;
    }

    void (async () => {
      try {
        const result = await fetchMyCapabilities();
        setCaps(result);
      } catch {
        setCaps(null);
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

  const allowed = !!caps && (caps.isOwner || caps.capabilities.length > 0);
  if (!allowed || !caps) {
    return <Navigate to="/" replace />;
  }

  return <AdminCapabilitiesProvider value={caps}>{children}</AdminCapabilitiesProvider>;
}
