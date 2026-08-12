/**
 * Public site destinations that are not CMS-editable.
 * Override via env on each Vercel project.
 */
export const HUB_APP_URL =
  process.env.NEXT_PUBLIC_HUB_APP_URL?.trim() || 'https://pinit-dna.vercel.app';

/** Hub signup entry (account type → biometric registration → dashboard). */
export function hubSignupUrl(): string {
  return `${HUB_APP_URL.replace(/\/$/, '')}/register/account-type`;
}

/** Hub login for returning users. */
export function hubLoginUrl(): string {
  return `${HUB_APP_URL.replace(/\/$/, '')}/login`;
}

/** YouTube, Vimeo, ScreenPal, or direct MP4 URL for “Watch Platform”. */
export const DEMO_VIDEO_URL =
  process.env.NEXT_PUBLIC_DEMO_VIDEO_URL?.trim() ||
  'https://go.screenpal.com/watch/cOj123nv0bo';

/** Public landing URL used by the admin CMS after save. */
export const LANDING_URL =
  process.env.LANDING_URL?.trim().replace(/\/$/, '') ||
  process.env.NEXT_PUBLIC_LANDING_URL?.trim().replace(/\/$/, '') ||
  'https://pinit-landing-page.vercel.app';

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
