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
