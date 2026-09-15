/**
 * Filters crawler/search URLs that are not useful for users or fingerprinting.
 */

const BLOCKED_HOST_PATTERNS = [
  /(^|\.)duckduckgo\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)bing\.com$/i,
  /(^|\.)yandex\.com$/i,
];

const BLOCKED_PATH_PATTERNS = [
  /\/t\/tqadb/i,
  /\/i\/-?\d+\.ico/i,
  /\/assets\/.*\.(svg|ico)(\?|$)/i,
];

/**
 * Hosts whose pages are search results, never a place an asset lives.
 *
 * Kept separate from BLOCKED_HOST_PATTERNS because the question is different:
 * that list asks "is this URL useless as an image", this asks "is this URL a
 * search results page". A search page recorded as an external asset candidate
 * means the system compares your work against the search engine's own page
 * furniture — which is exactly what produced 1,532 stored candidates at 0.000
 * similarity and not a single match in 3,992 runs.
 */
const SEARCH_RESULT_HOST_PATTERNS = [
  /(^|\.)duckduckgo\.com$/i,
  /(^|\.)google\.[a-z.]+$/i,
  /(^|\.)bing\.com$/i,
  /(^|\.)yandex\.[a-z.]+$/i,
  /(^|\.)search\.brave\.com$/i,
  /(^|\.)ecosia\.org$/i,
  /(^|\.)startpage\.com$/i,
  /(^|\.)baidu\.com$/i,
];

/**
 * True when this URL is a search results page rather than somewhere an asset
 * is published. Such a URL must never be recorded as a discovery candidate,
 * as either the image or the page it was found on.
 */
export function isSearchResultPageUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const trimmed = raw.trim();
    const url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
    const host = url.hostname.toLowerCase();
    if (SEARCH_RESULT_HOST_PATTERNS.some((re) => re.test(host))) return true;
    // A bare ?q= / ?query= on any host is a search page in all but name.
    const params = url.searchParams;
    return (params.has('q') || params.has('query')) && /search|\/html\/?$/i.test(url.pathname + host);
  } catch {
    return false;
  }
}

export function isBlockedCrawlerUrl(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('data:')) return true;

  try {
    const url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
    const host = url.hostname.toLowerCase();
    const path = `${url.pathname}${url.search}`;

    if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) return true;
    if (BLOCKED_PATH_PATTERNS.some((re) => re.test(path))) return true;
    return false;
  } catch {
    return true;
  }
}

export function decodeDdgRedirect(raw: string): string | null {
  if (!raw) return null;
  try {
    const href = raw.startsWith('//') ? `https:${raw}` : raw;
    const parsed = new URL(href);
    if (parsed.hostname.toLowerCase().includes('duckduckgo.com')) {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
      return null;
    }
    return href;
  } catch {
    return null;
  }
}

export function isDirectImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Best URL to show users — prefers real pages over CDN/tracker pixels. */
export function pickNavigableUrl(imageUrl: string, pageUrl: string): string | null {
  if (pageUrl && !isBlockedCrawlerUrl(pageUrl)) return pageUrl;
  if (imageUrl && !isBlockedCrawlerUrl(imageUrl)) return imageUrl;
  return null;
}
