/**
 * YouTube Studio adapter URL helpers (Sprint 4).
 * Keeps watch-URL extraction logic covered without a browser DOM.
 */

function extractWatchUrlFromHref(href: string, base = 'https://studio.youtube.com/'): string | null {
  try {
    const u = new URL(href, base);
    const id = u.searchParams.get('v');
    if (id && /^[\w-]{6,}$/.test(id)) {
      return `https://www.youtube.com/watch?v=${id}`;
    }
    if (u.hostname.includes('youtu.be')) {
      const shortId = u.pathname.replace(/^\//, '');
      if (shortId && /^[\w-]{6,}$/.test(shortId)) {
        return `https://www.youtube.com/watch?v=${shortId}`;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractWatchUrlFromPageUrl(pageUrl: string): string | null {
  try {
    const m = pageUrl.match(/[?&]video_id=([\w-]{6,})/);
    if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
    const pathId = pageUrl.match(/\/video\/([\w-]{6,})/);
    if (pathId) return `https://www.youtube.com/watch?v=${pathId[1]}`;
  } catch {
    return null;
  }
  return null;
}

function detectYoutubePlatform(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'studio.youtube.com' || host.endsWith('youtube.com')) return 'youtube';
  } catch {
    /* ignore */
  }
  return 'web';
}

describe('YouTube watch URL detection', () => {
  it('parses standard watch links', () => {
    expect(extractWatchUrlFromHref('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });

  it('parses youtu.be short links', () => {
    expect(extractWatchUrlFromHref('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });

  it('parses Studio video_id query and /video/ path', () => {
    expect(
      extractWatchUrlFromPageUrl('https://studio.youtube.com/video/dQw4w9WgXcQ/edit'),
    ).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(
      extractWatchUrlFromPageUrl('https://studio.youtube.com/channel/UC123/videos/upload?video_id=dQw4w9WgXcQ'),
    ).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('rejects invalid ids', () => {
    expect(extractWatchUrlFromHref('https://www.youtube.com/watch?v=ab')).toBeNull();
  });
});

describe('YouTube platform detection', () => {
  it('maps studio and youtube hosts', () => {
    expect(detectYoutubePlatform('https://studio.youtube.com/')).toBe('youtube');
    expect(detectYoutubePlatform('https://www.youtube.com/upload')).toBe('youtube');
    expect(detectYoutubePlatform('https://example.com')).toBe('web');
  });
});
