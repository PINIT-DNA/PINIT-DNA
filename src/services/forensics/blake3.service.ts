/**
 * BLAKE3 helper — lazy-loaded to avoid Jest ESM issues.
 */
export function computeBlake3Hex(buffer: Buffer): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { blake3 } = require('@noble/hashes/blake3.js') as { blake3: (b: Uint8Array) => Uint8Array };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bytesToHex } = require('@noble/hashes/utils.js') as { bytesToHex: (b: Uint8Array) => string };
    return bytesToHex(blake3(buffer));
  } catch {
    return null;
  }
}
