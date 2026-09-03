/**
 * Rewrite Hub share URLs so buyers never receive an API or localhost link.
 * Canonical viewer: https://www.pinithub.com/s/<token>
 */

export const PRODUCTION_HUB_APP_ORIGIN = 'https://www.pinithub.com';
export const DEV_HUB_APP_ORIGIN = 'http://localhost:3002';

function stripSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function originOnly(value) {
  const raw = stripSlash(value).replace(/\/api\/v1$/i, '');
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return raw;
  }
}

export function isShareApiHost(url) {
  const host = originOnly(url).toLowerCase();
  return (
    /onrender\.com/i.test(host)
    || /\/api(\/|$)/i.test(stripSlash(url))
    || /:4000\b/.test(host)
    || /pinit-dna-uf5y/i.test(host)
    || /pinit-dna-3fmw/i.test(host)
    || /pinitexchange\.com/i.test(host)
  );
}

export function isLocalShareHost(url) {
  return /localhost|127\.0\.0\.1/i.test(originOnly(url));
}

/** Hub Vite is port 3002. :3000 is a stale env value and nothing is listening. */
export function isStaleLocalHubOrigin(url) {
  return /localhost:3000\b|127\.0\.0\.1:3000\b/i.test(originOnly(url));
}

export function isProductionShareEnv(env = process.env) {
  return env.NODE_ENV === 'production' || Boolean(env.RENDER);
}

export function resolveShareViewerOrigin(preferred, env = process.env) {
  const prod = isProductionShareEnv(env);
  const fallback = prod ? PRODUCTION_HUB_APP_ORIGIN : DEV_HUB_APP_ORIGIN;
  const candidates = [
    preferred,
    env.SHARE_PUBLIC_BASE_URL,
    env.HUB_APP_URL,
    env.PUBLIC_APP_URL,
    env.FRONTEND_URL,
  ];
  for (const raw of candidates) {
    if (!raw || !String(raw).trim()) continue;
    const origin = originOnly(String(raw));
    if (!origin) continue;
    if (isShareApiHost(origin)) continue;
    if (isStaleLocalHubOrigin(origin)) continue;
    if (prod && isLocalShareHost(origin)) continue;
    if (!prod && /pinithub\.com/i.test(origin) && env.SHARE_USE_PRODUCTION_VIEWER !== 'true') {
      continue;
    }
    return origin;
  }
  return fallback;
}

export function publicLicensedShareUrl(token, preferredOrigin, env = process.env) {
  const safe = String(token || '').trim();
  if (!safe) return '';
  return `${resolveShareViewerOrigin(preferredOrigin, env)}/s/${safe}`;
}
