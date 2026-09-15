/**
 * Public Hub share viewer origin + path.
 *
 * Canonical route is `/s/:token` (ShareViewerPage). `/share/:token` is an alias.
 * Never point recipients at the Hub API host, Exchange, or /api/v1/exchange/delivery/.
 */

export const PRODUCTION_HUB_APP_ORIGIN = 'https://www.pinithub.com';
export const DEV_HUB_APP_ORIGIN = 'http://localhost:3002';

function stripSlash(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function originOnly(value: string): string {
  const raw = stripSlash(value).replace(/\/api\/v1$/i, '');
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return raw;
  }
}

export function isShareApiHost(url: string): boolean {
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

export function isLocalShareHost(url: string): boolean {
  const host = originOnly(url).toLowerCase();
  return /localhost|127\.0\.0\.1/i.test(host);
}

export function isProductionShareEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV'] === 'production' || Boolean(env['RENDER']);
}

/**
 * Frontend origin that actually serves the share viewer.
 */
export function resolveShareViewerOrigin(
  preferred?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const prod = isProductionShareEnv(env);
  const fallback = prod ? PRODUCTION_HUB_APP_ORIGIN : DEV_HUB_APP_ORIGIN;
  const candidates = [
    preferred,
    env['SHARE_PUBLIC_BASE_URL'],
    env['HUB_APP_URL'],
    env['PUBLIC_APP_URL'],
    env['FRONTEND_URL'],
  ];

  for (const raw of candidates) {
    if (!raw || !String(raw).trim()) continue;
    const origin = originOnly(String(raw));
    if (!origin) continue;
    if (isShareApiHost(origin)) continue;
    if (prod && isLocalShareHost(origin)) continue;
    // Local Protect stores the file on this machine. pinithub.com talks to
    // Render, which cannot read that disk unless the blob is in Supabase.
    if (!prod && /pinithub\.com/i.test(origin) && env['SHARE_USE_PRODUCTION_VIEWER'] !== 'true') {
      continue;
    }
    return origin;
  }

  return fallback;
}

export function buildShareViewerUrl(
  token: string,
  preferredOrigin?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const safe = String(token || '').trim();
  if (!safe) throw new Error('Share token is required');
  return `${resolveShareViewerOrigin(preferredOrigin, env)}/s/${safe}`;
}
