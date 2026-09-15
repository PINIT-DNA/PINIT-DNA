import { vaultEncryptedLooksLikeLocalPath } from '../../src/services/vault/vault-storage-path';

describe('vaultEncryptedLooksLikeLocalPath', () => {
  test('treats Windows and unix vault dirs as local', () => {
    expect(vaultEncryptedLooksLikeLocalPath('C:\\Users\\me\\Pinit-DNA\\vault\\encrypted\\abc.enc')).toBe(true);
    expect(vaultEncryptedLooksLikeLocalPath('/home/u/Pinit-DNA/vault/encrypted/abc.enc')).toBe(true);
  });

  test('treats Supabase object keys as remote', () => {
    expect(vaultEncryptedLooksLikeLocalPath('user-uuid/vault-uuid.enc')).toBe(false);
    expect(vaultEncryptedLooksLikeLocalPath('vault-uuid.enc')).toBe(false);
    expect(vaultEncryptedLooksLikeLocalPath('')).toBe(false);
  });
});
