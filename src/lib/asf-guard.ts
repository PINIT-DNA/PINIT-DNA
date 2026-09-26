/**
 * ASF (WMA/WMV) container guard.
 *
 * Both `music-metadata` (<= 11.12.1, high) and `file-type` (13.0.0 - 21.3.0, moderate)
 * have an infinite loop in their ASF parsers, so a crafted file could hang the process.
 * Upgrading either is a breaking major bump (ESM-only) and this project compiles to
 * CommonJS, so instead callers skip those parsers for buffers that start with the ASF
 * header GUID and fall back to their non-parsing paths.
 */
const ASF_HEADER_GUID = Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex');

export function looksLikeAsf(buf: Buffer): boolean {
  return buf.length >= ASF_HEADER_GUID.length && buf.subarray(0, ASF_HEADER_GUID.length).equals(ASF_HEADER_GUID);
}
