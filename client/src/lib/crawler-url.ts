/** Client-side mirror of crawler URL sanitization for alert links. */

const BLOCKED_HOSTS = ['duckduckgo.com', 'google.com', 'bing.com'];

export function isBlockedAlertUrl(raw: string | null | undefined): boolean {
  if (!raw?.trim() || raw.startsWith('data:')) return true;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (BLOCKED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
    if (/\/t\/tqadb/i.test(url.pathname)) return true;
    return false;
  } catch {
    return true;
  }
}

export function resolveAlertUrl(alert: {
  url: string;
  foundText?: string | null;
}): string | null {
  if (alert.foundText) {
    try {
      const meta = JSON.parse(alert.foundText) as { pageUrl?: string; imageUrl?: string };
      if (meta.pageUrl && !isBlockedAlertUrl(meta.pageUrl)) return meta.pageUrl;
      if (meta.imageUrl && !isBlockedAlertUrl(meta.imageUrl)) return meta.imageUrl;
    } catch {
      // not JSON metadata
    }
  }
  if (!isBlockedAlertUrl(alert.url)) return alert.url;
  return null;
}
