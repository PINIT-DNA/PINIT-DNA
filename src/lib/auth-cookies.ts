/**
 * HttpOnly refresh-token cookie for Hub.
 * Access JWTs stay Bearer (sent by the SPA). Refresh is not readable by JS.
 */
import type { Request, Response } from 'express';

export const HUB_REFRESH_COOKIE = 'pinit_rt';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '');
  return proto.toLowerCase().includes('https');
}

export function refreshCookieOptions(req: Request) {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    secure,
    sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    maxAge: MAX_AGE_MS,
  };
}

export function readRefreshCookie(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== HUB_REFRESH_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

export function setRefreshCookie(req: Request, res: Response, token: string): void {
  res.cookie(HUB_REFRESH_COOKIE, token, refreshCookieOptions(req));
}

export function clearRefreshCookie(req: Request, res: Response): void {
  res.cookie(HUB_REFRESH_COOKIE, '', { ...refreshCookieOptions(req), maxAge: 0 });
}
