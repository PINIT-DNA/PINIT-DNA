import { vaultPreviewBlobLooksLikeJson } from '../../client/src/lib/vault-preview-bytes';

describe('vaultPreviewBlobLooksLikeJson', () => {
  test('detects JSON error bodies', () => {
    expect(vaultPreviewBlobLooksLikeJson(new TextEncoder().encode('{"error":"no"}'))).toBe(true);
    expect(vaultPreviewBlobLooksLikeJson(new TextEncoder().encode('  [1]'))).toBe(true);
  });

  test('does not flag JPEG/PNG magic', () => {
    expect(vaultPreviewBlobLooksLikeJson(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
    expect(vaultPreviewBlobLooksLikeJson(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});
