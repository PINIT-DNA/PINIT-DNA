/** Portfolio pages live on Hub. Old payloads still pointed at Exchange :5174. */
export function hubPortfolioHref(url: string, slug?: string): string {
  const raw = String(url || '').trim();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (raw) {
    const rewritten = raw.replace(/https?:\/\/localhost:5174/gi, origin || 'http://localhost:3002');
    try {
      const u = new URL(rewritten, origin || 'http://localhost:3002');
      if (u.pathname.startsWith('/p/')) return `${u.pathname}${u.search}`;
      return rewritten;
    } catch {
      return rewritten;
    }
  }
  if (slug) return `/p/${encodeURIComponent(slug)}`;
  return '/profile?tab=portfolio';
}
