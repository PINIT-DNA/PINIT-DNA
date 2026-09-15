import { LANDING_URL } from '@/lib/site';

/**
 * After a successful CMS save: go to the live landing page so edits are visible.
 */
export function openLiveLanding(previewUrl?: string) {
  const base = (previewUrl?.trim() || LANDING_URL).replace(/\/$/, '');
  if (!base) return;

  const url = new URL(base);
  url.searchParams.set('preview', String(Date.now()));
  window.location.assign(url.toString());
}
