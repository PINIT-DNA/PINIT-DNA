/**
 * Safe allow-list for Exchange return URLs after Hub login/register SSO.
 */
export function safeExchangeReturnUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowed =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('pinithub.com') ||
      host.endsWith('pinitexchange.com') ||
      host.endsWith('vercel.app');
    if (!allowed) return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

const STORAGE_KEY = 'pinit_exchange_return';

export function stashExchangeReturn(url: string | null): void {
  try {
    if (url) sessionStorage.setItem(STORAGE_KEY, url);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function takeStashedExchangeReturn(): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) sessionStorage.removeItem(STORAGE_KEY);
    return safeExchangeReturnUrl(raw);
  } catch {
    return null;
  }
}

export function peekStashedExchangeReturn(): string | null {
  try {
    return safeExchangeReturnUrl(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function resolveExchangeReturn(searchParam: string | null): string | null {
  return safeExchangeReturnUrl(searchParam) || peekStashedExchangeReturn();
}
