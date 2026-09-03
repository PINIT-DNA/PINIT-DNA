/**
 * Public site destinations that are not CMS-editable.
 * Override via env on each Vercel project.
 *
 * Domain cutover (www.pinithub.com):
 *   - Landing owns the domain (this Next.js project).
 *   - Hub routes (/login, /vault, /s/…, /share/…, /static/…) are reverse-proxied
 *     to the Hub Vercel app via vercel.json rewrites.
 *   - Set NEXT_PUBLIC_HUB_APP_URL=https://www.pinithub.com (or empty "")
 *     so Log in / Get started stay on the same domain.
 */
const rawHub = process.env.NEXT_PUBLIC_HUB_APP_URL;
export const HUB_APP_URL =
  rawHub !== undefined
    ? rawHub.trim().replace(/\/$/, '')
    : 'https://www.pinithub.com';

function hubPath(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return HUB_APP_URL ? `${HUB_APP_URL}${p}` : p;
}

/** Hub signup entry (account type → biometric registration → dashboard). */
export function hubSignupUrl(): string {
  return hubPath('/register/account-type');
}

/** Hub login for returning users. */
export function hubLoginUrl(): string {
  return hubPath('/login');
}

/** YouTube, Vimeo, ScreenPal, or direct MP4 URL for “Watch demo”. */
export const DEMO_VIDEO_URL =
  process.env.NEXT_PUBLIC_DEMO_VIDEO_URL?.trim() ||
  '/videos/PinIT_Hub_Animated_Demo.mp4';

/** Public landing URL used by the admin CMS after save. */
export const LANDING_URL =
  process.env.LANDING_URL?.trim().replace(/\/$/, '') ||
  process.env.NEXT_PUBLIC_LANDING_URL?.trim().replace(/\/$/, '') ||
  'https://www.pinithub.com';

/**
 * Deploy surface:
 *   public — landing only; /admin returns 404
 *   admin  — CMS only; `/` redirects to /admin
 *   full   — both (local development default)
 */
export type AppSurface = 'public' | 'admin' | 'full';

export function appSurface(): AppSurface {
  const raw = (process.env.APP_SURFACE || process.env.NEXT_PUBLIC_APP_SURFACE || 'full')
    .trim()
    .toLowerCase();
  if (raw === 'public' || raw === 'landing') return 'public';
  if (raw === 'admin' || raw === 'cms') return 'admin';
  return 'full';
}
