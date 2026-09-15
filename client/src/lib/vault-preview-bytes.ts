/** True when a vault preview blob is JSON (auth/API error served as blob). */
export function vaultPreviewBlobLooksLikeJson(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) {
    i += 1;
  }
  const c = bytes[i];
  return c === 0x7b || c === 0x5b; // { or [
}
