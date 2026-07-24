import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { useSubscription, invalidateSubscriptionCache } from '../hooks/useSubscription';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { saveTokens } from '../lib/auth';
import {
  getAccountViewMode,
  setAccountViewMode,
  type AccountViewMode,
} from '../lib/account-view-mode';
import { BUSINESS_DASHBOARD_PATH } from '../lib/subscription/post-upgrade-redirect';
import {
  clearBusinessSetup,
  markAccountTypeOnboardingComplete,
  setChosenAccountType,
} from '../lib/account-onboarding';

interface AccountViewModeContextValue {
  mode: AccountViewMode;
  /** Registered account type from JWT / subscription */
  accountType: AccountViewMode;
  /** True when this login can use the Business shell (org / business account / enterprise) */
  hasBusinessAccess: boolean;
  /** True when UI should use Organization nav + business home */
  isBusinessShell: boolean;
  switching: boolean;
  switchTo: (next: AccountViewMode) => Promise<void>;
  canSwitch: boolean;
}

const AccountViewModeContext = createContext<AccountViewModeContextValue | null>(null);

const BUSINESS_PATH_RE = /^\/business(\/|$)/;

function isBusinessPath(pathname: string): boolean {
  return BUSINESS_PATH_RE.test(pathname);
}

export function AccountViewModeProvider({ children }: { children: ReactNode }) {
  const { user, loginWithFaceResponse } = useAuth();
  const { accountType, planCode, refresh } = useSubscription();
  const navigate = useNavigate();
  const location = useLocation();

  const registeredType = (user?.accountType ?? accountType ?? 'INDIVIDUAL') as AccountViewMode;
  /** Can use Business shell without converting again */
  const hasBusinessAccess = registeredType === 'BUSINESS' || planCode === 'ENTERPRISE';

  const [mode, setMode] = useState<AccountViewMode>(() =>
    getAccountViewMode(user?.sub, hasBusinessAccess ? 'BUSINESS' : 'INDIVIDUAL'),
  );
  const [switching, setSwitching] = useState(false);

  const isBusinessShell = mode === 'BUSINESS' && hasBusinessAccess;

  useEffect(() => {
    const preferred = getAccountViewMode(
      user?.sub,
      hasBusinessAccess ? registeredType : 'INDIVIDUAL',
    );
    // Pure individual accounts cannot stay in Business view
    if (!hasBusinessAccess && preferred === 'BUSINESS') {
      setMode('INDIVIDUAL');
      if (user?.sub) setAccountViewMode(user.sub, 'INDIVIDUAL');
      return;
    }
    setMode(preferred);
  }, [user?.sub, registeredType, hasBusinessAccess]);

  // Keep URL and shell aligned — never mix Individual nav with Business pages
  useEffect(() => {
    if (!user?.sub || switching) return;

    if (mode === 'INDIVIDUAL' && isBusinessPath(location.pathname)) {
      navigate('/', { replace: true });
      return;
    }

    if (isBusinessShell && location.pathname === '/') {
      navigate(BUSINESS_DASHBOARD_PATH, { replace: true });
    }
  }, [mode, isBusinessShell, location.pathname, user?.sub, switching, navigate]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ userId?: string; mode?: AccountViewMode }>).detail;
      if (detail?.userId && user?.sub && detail.userId !== user.sub) return;
      if (detail?.mode === 'INDIVIDUAL' || detail?.mode === 'BUSINESS') {
        setMode(detail.mode);
      }
    };
    window.addEventListener('pinit-account-view', onChange);
    return () => window.removeEventListener('pinit-account-view', onChange);
  }, [user?.sub]);

  const switchTo = useCallback(
    async (next: AccountViewMode) => {
      if (!user?.sub || switching) return;
      if (next === mode) {
        // Same mode — still land on the correct home
        navigate(next === 'BUSINESS' && hasBusinessAccess ? BUSINESS_DASHBOARD_PATH : '/', {
          replace: true,
        });
        return;
      }

      // ── Business ↔ Individual when org already exists (view only) ─────────
      if (hasBusinessAccess) {
        setAccountViewMode(user.sub, next);
        setMode(next);
        if (next === 'BUSINESS') {
          navigate(BUSINESS_DASHBOARD_PATH, { replace: true });
          toast.success('Switched to Business dashboard');
        } else {
          navigate('/', { replace: true });
          toast.success('Switched to Individual dashboard');
        }
        return;
      }

      // ── Individual-only account enabling Business for the first time ─────
      if (next === 'BUSINESS') {
        const ok = window.confirm(
          'Set up a Business account? This enables organization features (Team, Audit, API). You can return to the Individual dashboard anytime.',
        );
        if (!ok) return;

        setSwitching(true);
        try {
          const { data } = await api.post<{
            success: boolean;
            accessToken?: string;
            refreshToken?: string;
            accountType?: AccountViewMode;
          }>(`${API_BASE_URL}/auth/account-type`, { accountType: 'BUSINESS' });

          if (data.accessToken) {
            saveTokens(data.accessToken, data.refreshToken ?? '');
            loginWithFaceResponse({
              accessToken: data.accessToken,
              refreshToken: data.refreshToken,
            });
          }
          setChosenAccountType(user.sub, 'BUSINESS');
          markAccountTypeOnboardingComplete(user.sub);
          clearBusinessSetup(user.sub);
          invalidateSubscriptionCache();
          await refresh();
          setAccountViewMode(user.sub, 'BUSINESS');
          setMode('BUSINESS');
          navigate(BUSINESS_DASHBOARD_PATH, { replace: true });
          toast.success('Business account ready');
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not switch to Business');
        } finally {
          setSwitching(false);
        }
        return;
      }

      setAccountViewMode(user.sub, 'INDIVIDUAL');
      setMode('INDIVIDUAL');
      navigate('/', { replace: true });
    },
    [
      user?.sub,
      mode,
      switching,
      hasBusinessAccess,
      navigate,
      loginWithFaceResponse,
      refresh,
    ],
  );

  const value = useMemo<AccountViewModeContextValue>(
    () => ({
      mode,
      accountType: registeredType,
      hasBusinessAccess,
      isBusinessShell,
      switching,
      switchTo,
      canSwitch: Boolean(user?.sub),
    }),
    [mode, registeredType, hasBusinessAccess, isBusinessShell, switching, switchTo, user?.sub],
  );

  return (
    <AccountViewModeContext.Provider value={value}>
      {children}
    </AccountViewModeContext.Provider>
  );
}

export function useAccountViewMode(): AccountViewModeContextValue {
  const ctx = useContext(AccountViewModeContext);
  if (!ctx) {
    throw new Error('useAccountViewMode must be used within AccountViewModeProvider');
  }
  return ctx;
}
