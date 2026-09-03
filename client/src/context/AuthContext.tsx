import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import {
  AuthUser, getAccessToken, parseJwt, clearTokens,
  apiLogout, refreshAccessToken, applyFaceAuthTokens, apiFetchMe,
  hasValidAccessToken, subscribeAuthEvents,
} from '../lib/auth';
import { syncServerAccountTypeOnboarding } from '../lib/account-onboarding';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  loginWithFaceResponse: (data: { accessToken?: string; refreshToken?: string }) => void;
  logout: () => Promise<void>;
  /** Drop leftover JWT/local user without a server round-trip — used at biometric login/register start. */
  resetLocalSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromToken(token: string | null): AuthUser | null {
  if (!token || !hasValidAccessToken(token)) return null;
  return parseJwt(token);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        let token = getAccessToken();
        if (!hasValidAccessToken(token)) {
          const next = await refreshAccessToken();
          token = next;
        }

        if (!hasValidAccessToken(token)) {
          if (!cancelled) setUser(null);
          return;
        }

        try {
          const me = await apiFetchMe();
          if (cancelled) return;
          if (me) {
            syncServerAccountTypeOnboarding(me);
            setUser(me);
            return;
          }
        } catch (e: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const status = (e as any)?.response?.status as number | undefined;
          if (!status) {
            // Network / backend waking: keep a locally valid JWT rather than bounce to login.
            const parsed = userFromToken(token);
            if (!cancelled && parsed) {
              syncServerAccountTypeOnboarding(parsed);
              setUser(parsed);
            }
            return;
          }
          if (status === 401) {
            const next = await refreshAccessToken();
            if (next) {
              try {
                const me = await apiFetchMe();
                if (!cancelled && me) {
                  syncServerAccountTypeOnboarding(me);
                  setUser(me);
                  return;
                }
              } catch { /* fall through */ }
              const parsed = userFromToken(next);
              if (!cancelled && parsed) {
                setUser(parsed);
                return;
              }
            }
            if (!cancelled) {
              clearTokens();
              setUser(null);
            }
            return;
          }
        }

        const parsed = userFromToken(token);
        if (!cancelled && parsed) {
          syncServerAccountTypeOnboarding(parsed);
          setUser(parsed);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return subscribeAuthEvents((type) => {
      if (type === 'logout') {
        clearTokens();
        setUser(null);
        return;
      }
      const parsed = userFromToken(getAccessToken());
      if (parsed) setUser(parsed);
    });
  }, []);

  function loginWithFaceResponse(data: { accessToken?: string; refreshToken?: string }) {
    const u = applyFaceAuthTokens(data);
    if (u) {
      syncServerAccountTypeOnboarding(u);
      setUser(u);
    } else if (data.accessToken) {
      const parsed = parseJwt(data.accessToken);
      if (parsed) {
        syncServerAccountTypeOnboarding(parsed);
        setUser(parsed);
      }
    }
  }

  const resetLocalSession = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginWithFaceResponse, logout, resetLocalSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
