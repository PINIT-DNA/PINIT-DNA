/**
 * EXCHANGE_API_URL must never resolve to localhost in production.
 *
 * The old default sent every server-side Exchange call on Render to
 * http://localhost:5000, where nothing runs, so My Assets silently lost its
 * Exchange tags while localhost kept showing them.
 */

function loadConfig(env: Record<string, string>) {
  const saved = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: 'postgres://test/test' }, env);
  let apiUrl = '';
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    apiUrl = require('../../src/config').config.exchange.apiUrl;
  });
  process.env = saved;
  return apiUrl;
}

describe('config.exchange.apiUrl', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('falls back to the live Exchange API in production when unset', () => {
    // Empty rather than deleted, so a dotenv load cannot refill it from .env.
    expect(loadConfig({ NODE_ENV: 'production', EXCHANGE_API_URL: '' }))
      .toBe('https://pinit-dna-3fmw.onrender.com');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('EXCHANGE_API_URL is not set'))).toBe(true);
  });

  it('uses an explicit value and drops a trailing slash', () => {
    expect(loadConfig({ NODE_ENV: 'production', EXCHANGE_API_URL: 'https://exchange.example.com/' }))
      .toBe('https://exchange.example.com');
  });

  it('keeps the localhost default outside production', () => {
    expect(loadConfig({ NODE_ENV: 'development', EXCHANGE_API_URL: '' }))
      .toBe('http://localhost:5000');
  });
});
