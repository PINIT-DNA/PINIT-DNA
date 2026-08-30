import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AuthUser, getAccessToken, parseJwt, clearTokens, hasValidAccessToken } from '../lib/auth';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (token && hasValidAccessToken(token)) {
      setUser(parseJwt(token));
    } else {
      clearTokens();
    }
    setLoading(false);
  }, []);

  async function logout() {
    clearTokens();
    setUser(null);
    window.location.href = '/';
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
