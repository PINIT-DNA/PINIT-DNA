import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';

const BASE = `${API_BASE_URL}/auth`;

/**
 * POST with retry — survives Render free-tier cold starts (the backend sleeps
 * after ~15 min idle and the first request can 5xx / time out while it wakes).
 * Retries on network errors, timeouts, and 5xx responses.
 */
async function postWithRetry(url: string, body?: unknown, attempts = 4): Promise<{ data: unknown }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await axios.post(url, body, { timeout: 70000 });
    } catch (e: unknown) {
      lastErr = e;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (e as any)?.response?.status as number | undefined;
      const retryable = status === undefined || status >= 500; // network/timeout or server error
      if (!retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
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
}

export function getAccessToken(): string | null {
  return localStorage.getItem('pinit_access_token');
}

export function getRefreshToken(): string | null {
  return localStorage.getItem('pinit_refresh_token');
}

export function saveTokens(access: string, refresh: string) {
  localStorage.setItem('pinit_access_token', access);
  localStorage.setItem('pinit_refresh_token', refresh);
}

export function clearTokens() {
  localStorage.removeItem('pinit_access_token');
  localStorage.removeItem('pinit_refresh_token');
}

export function parseJwt(token: string): AuthUser | null {
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    return { sub: p.sub, shortId: p.shortId, name: p.name, role: p.role };
  } catch {
    return null;
  }
}

export async function apiCreateAccount(): Promise<AuthUser> {
  const res = await postWithRetry(`${BASE}/create`);
  const { accessToken, refreshToken } = (res.data as any).data;
  saveTokens(accessToken, refreshToken);
  return parseJwt(accessToken)!;
}

export async function apiLogin(shortId: string): Promise<AuthUser> {
  const res = await postWithRetry(`${BASE}/login`, { shortId });
  const { accessToken, refreshToken } = (res.data as any).data;
  saveTokens(accessToken, refreshToken);
  return parseJwt(accessToken)!;
}

export async function apiLogout() {
  const refreshToken = getRefreshToken();
  clearTokens();
  if (refreshToken) await axios.post(`${BASE}/logout`, { refreshToken }).catch(() => {});
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${BASE}/refresh`, { refreshToken });
    const { accessToken, refreshToken: newRefresh } = (res.data as any).data;
    saveTokens(accessToken, newRefresh);
    return accessToken;
  } catch {
    clearTokens();
    return null;
  }
}
