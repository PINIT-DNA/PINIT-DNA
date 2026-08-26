/**
 * Reverse-image provider registry.
 *
 * Discovery needs one thing this system cannot supply itself: somebody who will
 * take an image and tell you where else on the internet it appears. That is a
 * paid third-party service, and until one is configured, discovery cannot work
 * no matter how healthy everything around it looks.
 *
 * ── Why there is no provider registered right now ───────────────────────────
 *
 * The original build used the Bing Image Search API. Microsoft retired the Bing
 * Search APIs in August 2025, so `BING_SEARCH_API_KEY` cannot be obtained any
 * more — not by this project, not by anyone. Leaving that provider registered
 * made the system report "not configured — missing credentials", which reads as
 * *add a key and this works*. It does not. The key no longer exists to add.
 *
 * That provider has been removed rather than left in place returning nothing.
 *
 * ── What is here instead ────────────────────────────────────────────────────
 *
 * The `ImageSearchProvider` interface is unchanged and the slot is open. The
 * candidates below are recorded so the next person does not have to redo the
 * research, but NONE is implemented: implementing one before it is chosen and
 * paid for would produce a provider that is registered, configured-looking and
 * silently useless — exactly the failure this file exists to prevent.
 *
 * To add one: implement `ImageSearchProvider`, add it to `SUPPORTED`, and set
 * its environment variable. `getActiveProvider()` picks it up with no other
 * change, and the monitoring UI stops saying discovery is unavailable.
 */
import type { ImageSearchProvider } from './image-search.provider';

/** A provider the project could adopt, and what adopting it would take. */
export interface SupportedProvider {
  id: string;
  label: string;
  /** The environment variable that would configure it. */
  envVar: string;
  /** Built and ready, or a candidate nobody has implemented yet. */
  implemented: boolean;
  /** Short, honest note for whoever picks. */
  note: string;
}

/**
 * Candidates, researched but deliberately not built.
 *
 * Ordered by how well each fits: reverse-image search on the actual pixels is
 * what is needed. Keyword search over filenames is not a substitute — that is
 * what produced 3,992 scans and zero real matches.
 */
export const CANDIDATE_PROVIDERS: SupportedProvider[] = [
  {
    id: 'google-vision-web',
    label: 'Google Cloud Vision — Web Detection',
    envVar: 'GOOGLE_VISION_API_KEY',
    implemented: false,
    note: 'Matches on image content and returns pages carrying the image. '
      + 'Pay per call; the closest fit to what this system needs.',
  },
  {
    id: 'tineye',
    label: 'TinEye Commercial API',
    envVar: 'TINEYE_API_KEY',
    implemented: false,
    note: 'Purpose-built reverse image search with a large index. '
      + 'Bundle pricing; strongest for finding exact and edited copies.',
  },
  {
    id: 'serpapi-reverse-image',
    label: 'SerpAPI — Google Reverse Image',
    envVar: 'SERPAPI_KEY',
    implemented: false,
    note: 'A hosted wrapper around Google reverse image search. '
      + 'Simplest to adopt; the dependency is a reseller rather than the source.',
  },
];

/**
 * Providers actually available to the engine.
 *
 * Empty by design. Adding an entry here is the single switch that turns
 * discovery on, and nothing should be added until it genuinely works.
 */
export const SUPPORTED: ImageSearchProvider[] = [];

/** The provider discovery will use, or null when none is configured. */
export function getActiveProvider(): ImageSearchProvider | null {
  return SUPPORTED.find((p) => p.isConfigured()) ?? null;
}

/** Whether reverse-image discovery can run at all. */
export function hasReverseImageProvider(): boolean {
  return getActiveProvider() !== null;
}

/**
 * What to tell a person about discovery.
 *
 * Separates the two states that matter and are easy to confuse: nothing is
 * implemented, versus something is implemented but its key is missing.
 */
export function providerStatus(): {
  configured: boolean;
  activeName: string | null;
  implementedCount: number;
  candidates: SupportedProvider[];
  summary: string;
} {
  const active = getActiveProvider();
  const implemented = SUPPORTED.length;

  const summary = active
    ? `Reverse-image discovery is running on ${active.name}.`
    : implemented > 0
      ? 'A reverse-image provider is built but not configured — its key is missing.'
      : 'No reverse-image provider is configured, so nothing is searching for copies '
        + 'of your work. This needs a paid third-party service to be chosen first.';

  return {
    configured: Boolean(active),
    activeName: active?.name ?? null,
    implementedCount: implemented,
    candidates: CANDIDATE_PROVIDERS,
    summary,
  };
}
