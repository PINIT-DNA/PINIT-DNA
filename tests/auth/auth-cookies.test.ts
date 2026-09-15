import { HUB_REFRESH_COOKIE, readRefreshCookie } from '../../src/lib/auth-cookies';

describe('readRefreshCookie', () => {
  it('parses the Hub refresh cookie from the Cookie header', () => {
    const req = {
      headers: { cookie: `other=1; ${HUB_REFRESH_COOKIE}=rt%2Bvalue; theme=dark` },
    } as any;
    expect(readRefreshCookie(req)).toBe('rt+value');
  });

  it('returns undefined when the cookie is absent', () => {
    const req = { headers: { cookie: 'theme=dark' } } as any;
    expect(readRefreshCookie(req)).toBeUndefined();
  });
});
