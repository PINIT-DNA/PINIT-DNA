import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  AuthUser, getAccessToken, parseJwt, clearTokens,
  apiLogout, refreshAccessToken, applyFaceAuthTokens,
} from '../lib/auth';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  loginWithFaceResponse: (data: { accessToken?: string; refreshToken?: string }) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) { setLoading(false); return; }

    const parsed = parseJwt(token);
    if (!parsed) { clearTokens(); setLoading(false); return; }

    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      refreshAccessToken().then(t => {
        if (t) setUser(parseJwt(t));
        else { clearTokens(); setUser(null); }
        setLoading(false);
      });
    } else {
      setUser(parsed);
      setLoading(false);
    }
  }, []);

  function loginWithFaceResponse(data: { accessToken?: string; refreshToken?: string }) {
    const u = applyFaceAuthTokens(data);
    if (u) {
      setUser(u);
    } else if (data.accessToken) {
      const parsed = parseJwt(data.accessToken);
      if (parsed) setUser(parsed);
    }
  }

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginWithFaceResponse, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
