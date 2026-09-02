import {
  buildShareViewerUrl,
  isShareApiHost,
  resolveShareViewerOrigin,
} from '../../src/lib/share-viewer-url';

describe('share viewer URL', () => {
  test('rejects Hub API / Render hosts', () => {
    expect(isShareApiHost('https://pinit-dna-uf5y.onrender.com')).toBe(true);
    expect(isShareApiHost('https://pinit-dna-uf5y.onrender.com/api/v1')).toBe(true);
    expect(isShareApiHost('http://localhost:4000')).toBe(true);
    expect(isShareApiHost('https://www.pinitexchange.com')).toBe(true);
    expect(isShareApiHost('https://www.pinithub.com')).toBe(false);
    expect(isShareApiHost('http://localhost:3002')).toBe(false);
  });

  test('production never emits localhost or API hosts', () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_APP_URL: 'https://pinit-dna-uf5y.onrender.com',
      HUB_APP_URL: 'http://localhost:3002',
    } as NodeJS.ProcessEnv;
    expect(resolveShareViewerOrigin(undefined, env)).toBe('https://www.pinithub.com');
    expect(buildShareViewerUrl('AbC_token', undefined, env)).toBe(
      'https://www.pinithub.com/s/AbC_token',
    );
  });

  test('local prefers Hub UI origin', () => {
    const env = {
      NODE_ENV: 'development',
      HUB_APP_URL: 'http://localhost:3002',
      PUBLIC_APP_URL: 'http://localhost:4000',
    } as NodeJS.ProcessEnv;
    expect(buildShareViewerUrl('tok', undefined, env)).toBe('http://localhost:3002/s/tok');
  });
});
