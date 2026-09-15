import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';

const BASE = `${API_BASE_URL}/auth`;
const AUTH_EVENT_KEY = 'pinit_auth_event';
const AUTH_CHANNEL = 'pinit-hub-auth';

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'unavailable';

function credentialedPost(url: string, body?: unknown, timeout = 70000) {
  return axios.post(url, body ?? {}, { timeout, withCredentials: true });
}

/**
 * POST with retry — survives Render free-tier cold starts (the backend sleeps
 * after ~15 min idle and the first request can 5xx / time out while it wakes).
 * Retries on network errors, timeouts, and 5xx responses.
 */
function toApiError(e: unknown): Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax = e as any;
  const msg = ax?.response?.data?.error as string | undefined;
  if (msg) return new Error(msg);
  if (typeof ax?.message === 'string' && ax.message) return new Error(ax.message);
  return new Error('Request failed. Please try again.');
}

async function postWithRetry(url: string, body?: unknown, attempts = 4): Promise<{ data: unknown }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await axios.post(url, body, { timeout: 70000, withCredentials: true });
    } catch (e: unknown) {
      lastErr = e;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (e as any)?.response?.status as number | undefined;
      const retryable = status === undefined || status >= 500; // network/timeout or server error
      if (!retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw toApiError(lastErr);
}

/**
 * Fire-and-forget wake-up so the backend is awake by the time the (long)
 * registration/login flow finishes. Safe to call repeatedly.
 */
export function warmBackend(): void {
  axios.get(`${API_BASE_URL}/dna/supported-types`, { timeout: 70000 }).catch(() => {});
}

export interface AuthUser {
  sub: string;
  shortId: string;
  name: string;
  role: string;
  accountType?: 'INDIVIDUAL' | 'BUSINESS';
  capabilities?: {
    buyer_enabled?: boolean;
    can_purchase?: boolean;
    business?: boolean;
    business_setup_complete?: boolean;
  };
}

export function broadcastAuthEvent(type: 'login' | 'logout'): void {
  try {
    localStorage.setItem(AUTH_EVENT_KEY, JSON.stringify({ type, t: Date.now() }));
  } catch { /* ignore */ }
  try {
    const ch = new BroadcastChannel(AUTH_CHANNEL);
    ch.postMessage({ type });
    ch.close();
  } catch { /* unsupported */ }
}

export function subscribeAuthEvents(onEvent: (type: 'login' | 'logout') => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== AUTH_EVENT_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as { type?: string };
      if (parsed.type === 'login' || parsed.type === 'logout') onEvent(parsed.type);
    } catch { /* ignore */ }
  };
  window.addEventListener('storage', onStorage);
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(AUTH_CHANNEL);
    ch.onmessage = (ev: MessageEvent) => {
      const type = (ev.data as { type?: string } | undefined)?.type;
      if (type === 'login' || type === 'logout') onEvent(type);
    };
  } catch { /* ignore */ }
  return () => {
    window.removeEventListener('storage', onStorage);
    try { ch?.close(); } catch { /* ignore */ }
  };
}

export function getAccessToken(): string | null {
  return localStorage.getItem('pinit_access_token');
}

export function getRefreshToken(): string | null {
  return localStorage.getItem('pinit_refresh_token');
}

export function saveTokens(access: string, _refresh?: string) {
  localStorage.setItem('pinit_access_token', access);
  // Refresh lives in an HttpOnly cookie. Drop any leftover JS-readable copy.
  localStorage.removeItem('pinit_refresh_token');
}

export function clearTokens() {
  localStorage.removeItem('pinit_access_token');
  localStorage.removeItem('pinit_refresh_token');
}

/** Clear all user-specific client caches on logout — prevents cross-tenant data bleed. */
export function clearUserSessionCaches() {
  void import('../hooks/useOrganization').then(({ invalidateOrganizationCache }) => {
    invalidateOrganizationCache();
  }).catch(() => {});
  void import('../hooks/useUserProfile').then(({ invalidateUserProfileCache }) => {
    invalidateUserProfileCache();
  }).catch(() => {});
  void import('../hooks/useSubscription').then(({ invalidateSubscriptionCache }) => {
    invalidateSubscriptionCache();
  }).catch(() => {});
  void import('../hooks/useApi').then(({ invalidateApiCache }) => {
    invalidateApiCache();
  }).catch(() => {});
  try {
    sessionStorage.removeItem('pinit_pre_register_account_type');
    sessionStorage.removeItem('pinit_dna_reports');
    sessionStorage.removeItem('pinit_session');
    localStorage.removeItem('pinit_forensic_reports');
    const sessionKeys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('pinit_account_view')) sessionKeys.push(k);
    }
    for (const k of sessionKeys) sessionStorage.removeItem(k);
  } catch { /* SSR / privacy mode */ }
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k?.startsWith('pinit_')
        && k !== 'pinit_theme'
        && !k.startsWith('pinit_plan_choice_')
      ) keysToRemove.push(k);
    }
    for (const k of keysToRemove) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

export function parseJwt(token: string): AuthUser | null {
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    return {
      sub: p.sub,
      shortId: p.shortId,
      name: p.name,
      role: p.role,
      accountType: p.accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
    };
  } catch {
    return null;
  }
}

/**
 * True when a non-expired Hub access JWT is present. Refresh-only is not a session.
 */
export function hasValidAccessToken(token: string | null = getAccessToken()): boolean {
  if (!token || !parseJwt(token)) return false;
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    if (p.exp && p.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

/** Hub session = valid access JWT (refreshed from the HttpOnly cookie on boot). */
export function hasHubSession(): boolean {
  return hasValidAccessToken();
}

export { maySkipBiometricsForExchangeReturn } from './exchange-return-session';

export async function apiFetchMe(): Promise<AuthUser | null> {
  const token = getAccessToken();
  const res = await axios.get(`${BASE}/me`, {
    timeout: 70000,
    withCredentials: true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = (res.data as { data?: AuthUser } | undefined)?.data;
  if (!data?.sub || !data.shortId) return parseJwt(token || '') ;
  return {
    sub: data.sub,
    shortId: data.shortId,
    name: data.name,
    role: String(data.role || 'USER'),
    accountType: data.accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
    capabilities: data.capabilities,
  };
}

export async function apiCreateAccount(): Promise<AuthUser> {
  const res = await postWithRetry(`${BASE}/create`);
  const { accessToken, refreshToken } = (res.data as any).data;
  saveTokens(accessToken, refreshToken);
  broadcastAuthEvent('login');
  return parseJwt(accessToken)!;
}

/** Check shortId against the server without persisting tokens (login pre-flight). */
export async function apiVerifyShortId(shortId: string): Promise<{ valid: boolean; error?: string }> {
  try {
    await axios.post(`${BASE}/login`, { shortId }, { timeout: 70000, withCredentials: true });
    return { valid: true };
  } catch (e: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (e as any)?.response?.status as number | undefined;
    if (status === 401) return { valid: false, error: toApiError(e).message };
    throw toApiError(e);
  }
}

export async function apiLogin(shortId: string): Promise<AuthUser> {
  const res = await postWithRetry(`${BASE}/login`, { shortId });
  const { accessToken, refreshToken } = (res.data as any).data;
  saveTokens(accessToken, refreshToken);
  broadcastAuthEvent('login');
  return parseJwt(accessToken)!;
}

export async function apiLogout() {
  const refreshToken = getRefreshToken();
  try {
    await credentialedPost(`${BASE}/logout`, refreshToken ? { refreshToken } : {});
  } catch { /* still clear locally */ }
  clearTokens();
  clearUserSessionCaches();
  broadcastAuthEvent('logout');
}

export async function refreshAccessToken(): Promise<string | null> {
  const legacyRefresh = getRefreshToken();
  try {
    const res = await credentialedPost(
      `${BASE}/refresh`,
      legacyRefresh ? { refreshToken: legacyRefresh } : {},
    );
    const accessToken = (res.data as any)?.data?.accessToken as string | undefined;
    if (!accessToken) return null;
    saveTokens(accessToken);
    return accessToken;
  } catch (e: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (e as any)?.response?.status as number | undefined;
    if (status === 401) clearTokens();
    return null;
  }
}

/** Apply tokens returned from face register/login endpoints. */
export function applyFaceAuthTokens(data: { accessToken?: string; refreshToken?: string }): AuthUser | null {
  if (!data.accessToken) return null;
  saveTokens(data.accessToken, data.refreshToken);
  broadcastAuthEvent('login');
  return parseJwt(data.accessToken);
}
