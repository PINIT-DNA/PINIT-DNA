/**
 * PinitHUB Master Admin — session storage.
 *
 * Deliberately not a copy of the Hub SPA's lib/auth.ts: this app has no
 * password/biometric login and no refresh-token rotation. The only way in
 * is the SSO bridge (see pages/SsoLandingPage.tsx) — a Hub-issued short-lived
 * token exchanged once for a real Hub session JWT, stored here under its own
 * key so it never collides with the Hub SPA's localStorage on another origin.
 */
const TOKEN_KEY = 'master_admin_access_token';

export interface AuthUser {
  sub: string;
  shortId: string;
  name: string;
  role: string;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveAccessToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function parseJwt(token: string): AuthUser | null {
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    return { sub: p.sub, shortId: p.shortId, name: p.name, role: p.role };
  } catch {
    return null;
  }
}

export function hasValidAccessToken(token: string | null = getAccessToken()): boolean {
  if (!token) return false;
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    if (p.exp && p.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}
