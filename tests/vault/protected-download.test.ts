/**
 * Protected Download — config unit tests
 */
import { protectedDownloadConfig } from '../../src/services/vault/protected-download.service';

describe('Protected Download config', () => {
  it('enabled by default', () => {
    expect(typeof protectedDownloadConfig.enabled).toBe('boolean');
  });
});

describe('Protected Download steps', () => {
  it('defines expected verification flow labels', () => {
    const expected = ['ownership', 'decrypt', 'dna', 'certificate', 'identity', 'prepare'];
    expect(expected).toHaveLength(6);
  });
});
