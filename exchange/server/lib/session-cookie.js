/**
 * HttpOnly Exchange session cookie.
 * The HMAC session token must not be required in localStorage.
 */
export const EXCHANGE_SESSION_COOKIE = 'pinit_ex';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isSecureRequest(req) {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '');
  return proto.toLowerCase().includes('https');
}

export function sessionCookieOptions(req) {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'lax' : 'lax',
    path: '/',
    maxAge: MAX_AGE_MS,
  };
}

export function readSessionCookie(req) {
  const raw = req.headers?.cookie;
  if (!raw) return '';
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== EXCHANGE_SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return '';
}

export function setSessionCookie(req, res, token) {
  if (!token) return;
  res.cookie(EXCHANGE_SESSION_COOKIE, token, sessionCookieOptions(req));
}

export function clearSessionCookie(req, res) {
  res.cookie(EXCHANGE_SESSION_COOKIE, '', { ...sessionCookieOptions(req), maxAge: 0 });
}
