/**
 * Unit tests — Publish Guardian helpers (no DB).
 */

describe('Publish Guardian platform normalization', () => {
  function normalizePlatform(raw: string): string {
    const p = raw.trim().toLowerCase();
    if (p === 'twitter' || p === 'x.com') return 'x';
    if (p === 'ig') return 'instagram';
    if (p === 'fb') return 'facebook';
    if (p === 'yt') return 'youtube';
    return p || 'web';
  }

  function uniqueUrls(urls: Array<string | null | undefined>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const u of urls) {
      const t = (u ?? '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  function riskFromMatch(similarity: number, matchType: string, tampered: boolean): number {
    let base = Math.round(Math.min(100, Math.max(0, similarity * 100)));
    if (/EXACT|DUPLICATE/i.test(matchType)) base = Math.max(base, 90);
    else if (/NEAR/i.test(matchType)) base = Math.max(base, 75);
    if (tampered) base = Math.min(100, base + 10);
    return base;
  }

  test('normalizes twitter aliases to x', () => {
    expect(normalizePlatform('Twitter')).toBe('x');
    expect(normalizePlatform('ig')).toBe('instagram');
    expect(normalizePlatform('')).toBe('web');
  });

  test('dedupes watch URLs', () => {
    expect(uniqueUrls(['https://a.com', 'https://a.com', null, ' https://b.com '])).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  test('risk scoring floors EXACT matches', () => {
    expect(riskFromMatch(0.5, 'DUPLICATE', false)).toBeGreaterThanOrEqual(90);
    expect(riskFromMatch(0.8, 'NEAR_MATCH', true)).toBeGreaterThanOrEqual(85);
  });
});
