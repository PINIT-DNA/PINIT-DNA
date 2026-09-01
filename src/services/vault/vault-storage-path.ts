/** True when encryptedFilePath points at a filesystem path, not a Supabase object key. */
export function vaultEncryptedLooksLikeLocalPath(storedPath: string): boolean {
  const p = storedPath.trim();
  if (!p) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith('/') && !p.startsWith('//')) return true;
  return /[/\\]vault[/\\]encrypted[/\\]/i.test(p);
}
