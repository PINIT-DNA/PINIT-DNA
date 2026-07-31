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

export function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function parseAlertMetadata(foundText?: string | null): Record<string, unknown> | null {
  if (!foundText?.trim()) return null;
  try {
    const parsed = JSON.parse(foundText) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function resolveAlertUrl(alert: {
  url: string;
  foundText?: string | null;
}): string | null {
  const meta = parseAlertMetadata(alert.foundText);
  if (meta) {
    const videoId = typeof meta.videoId === 'string' ? meta.videoId : null;
    if (videoId) {
      const yt = buildYouTubeWatchUrl(videoId);
      if (!isBlockedAlertUrl(yt)) return yt;
    }
    if (typeof meta.pageUrl === 'string' && !isBlockedAlertUrl(meta.pageUrl)) return meta.pageUrl;
    if (typeof meta.imageUrl === 'string' && !isBlockedAlertUrl(meta.imageUrl)) return meta.imageUrl;
  }
  if (!isBlockedAlertUrl(alert.url)) return alert.url;
  return null;
}

export function resolveAlertSubtitle(alert: {
  foundText?: string | null;
  pageTitle?: string | null;
}): string | null {
  const meta = parseAlertMetadata(alert.foundText);
  if (meta) {
    const channel = typeof meta.channel === 'string' ? meta.channel : null;
    const source = typeof meta.source === 'string' ? meta.source.replace(/_/g, ' ') : null;
    const snippet = typeof meta.snippet === 'string' ? meta.snippet : null;
    if (channel && source) return `${source} · ${channel}`;
    if (channel) return channel;
    if (snippet) return snippet.slice(0, 120);
  }
  return alert.pageTitle ?? null;
}
