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
  const { user, loading: authLoading, loginWithFaceResponse } = useAuth();
  const { accountType, planCode, refresh, loading: subscriptionLoading } = useSubscription();
  const navigate = useNavigate();
  const location = useLocation();

  // JWT is available first on reload — never trust subscription FREE fallback while still loading.
  const jwtIsBusiness = user?.accountType === 'BUSINESS';
  const subscriptionReady = !subscriptionLoading;
  const subIsBusiness =
    subscriptionReady && (accountType === 'BUSINESS' || planCode === 'ENTERPRISE');
  const hasBusinessAccess = jwtIsBusiness || subIsBusiness;

  const registeredType: AccountViewMode = hasBusinessAccess
    ? 'BUSINESS'
    : ((user?.accountType ?? (subscriptionReady ? accountType : undefined) ?? 'INDIVIDUAL') as AccountViewMode);

  /** Resolve access from JWT immediately — subscription refines in background. */
  const accessResolved = Boolean(user?.sub) && !authLoading;

  const [mode, setMode] = useState<AccountViewMode>(() =>
    getAccountViewMode(user?.sub, hasBusinessAccess ? 'BUSINESS' : 'INDIVIDUAL'),
  );
  const [switching, setSwitching] = useState(false);

  const isBusinessShell = mode === 'BUSINESS' && hasBusinessAccess;

  useEffect(() => {
    if (!accessResolved || !user?.sub) return;

    const preferred = getAccountViewMode(
      user.sub,
      hasBusinessAccess ? 'BUSINESS' : 'INDIVIDUAL',
    );

    // Pure individual accounts cannot stay in Business view — only after access is resolved
    if (!hasBusinessAccess) {
      if (preferred === 'BUSINESS') {
        setAccountViewMode(user.sub, 'INDIVIDUAL');
      }
      setMode('INDIVIDUAL');
      return;
    }

    // Reloading on a Business URL should keep Business shell (heals a bad INDIVIDUAL wipe)
    if (preferred === 'INDIVIDUAL' && isBusinessPath(location.pathname)) {
      setAccountViewMode(user.sub, 'BUSINESS');
      setMode('BUSINESS');
      return;
    }

    setMode(preferred);
  }, [user?.sub, hasBusinessAccess, accessResolved, location.pathname]);

  // Keep URL and shell aligned — never mix Individual nav with Business pages
  useEffect(() => {
    if (!accessResolved || !user?.sub || switching) return;

    if (mode === 'INDIVIDUAL' && isBusinessPath(location.pathname)) {
      navigate('/', { replace: true });
      return;
    }

    if (isBusinessShell && location.pathname === '/') {
      navigate(BUSINESS_DASHBOARD_PATH, { replace: true });
    }
  }, [
    mode,
    isBusinessShell,
    location.pathname,
    user?.sub,
    switching,
    navigate,
    accessResolved,
  ]);

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

      // ── Business ↔ Individual when org already exists (view only — same account) ─
      if (hasBusinessAccess) {
        setAccountViewMode(user.sub, next);
        setMode(next);
        if (next === 'BUSINESS') {
          navigate(BUSINESS_DASHBOARD_PATH, { replace: true });
          toast.success('Business mode — same account, ORG ID');
        } else {
          navigate('/', { replace: true });
          toast.success('Individual mode — same account, USER ID');
        }
        return;
      }

      // ── Individual-only: enable Business mode on the SAME face / ShortId ─────
      if (next === 'BUSINESS') {
        const rootId = user.shortId ?? 'your PINIT ID';
        const ok = window.confirm(
          `Enable Business mode on ${rootId}?\n\n` +
            'This is NOT a new account. Same face → same number:\n' +
            `• Individual: PINIT-USER-…\n` +
            `• Business:   PINIT-ORG-…\n\n` +
            'You can switch back to Individual anytime.',
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
          toast.success('Business mode enabled on your existing PINIT ID');
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not enable Business mode');
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
