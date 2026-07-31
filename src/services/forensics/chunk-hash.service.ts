/**
 * Chunk-based hashing — no external deps (Jest-safe).
 */
import crypto from 'crypto';

export function computeChunkHashes(buffer: Buffer, chunkSize: number): string[] {
  const hashes: string[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
    hashes.push(crypto.createHash('sha256').update(chunk).digest('hex'));
  }
  return hashes;
}

export function chunkHashSimilarity(probe: string[], stored: string[]): number {
  if (!probe.length || !stored.length) return 0;
  const storedSet = new Set(stored);
  const matches = probe.filter((h) => storedSet.has(h)).length;
  return matches / Math.max(probe.length, stored.length);
}

export function computeSha3_512Hex(buffer: Buffer): string {
  return crypto.createHash('sha3-512').update(buffer).digest('hex');
}
