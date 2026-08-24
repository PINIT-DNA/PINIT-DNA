import { revalidatePath, revalidateTag } from 'next/cache';
import { CONTENT_TAG } from '@/lib/content';
import { appSurface, LANDING_URL } from '@/lib/site';

/**
 * Clear local CMS cache, then tell the public landing host to do the same.
 * Returns the public landing URL so the admin UI can open it after save.
 */
export async function refreshPublicContent(): Promise<string | undefined> {
  revalidateTag(CONTENT_TAG);
  revalidatePath('/', 'layout');

  const landingUrl = LANDING_URL;
  const secret = process.env.REVALIDATE_SECRET?.trim();

  // Local single-host: same origin already serves the landing page.
  if (appSurface() === 'full') {
    return undefined;
  }

  if (secret) {
    try {
      const response = await fetch(`${landingUrl}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`[revalidate] landing returned ${response.status}: ${text.slice(0, 200)}`);
      }
    } catch (error) {
      console.error('[revalidate] failed to notify landing —', error);
    }
  }

  return landingUrl;
}
