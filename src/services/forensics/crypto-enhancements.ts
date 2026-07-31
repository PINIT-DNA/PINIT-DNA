/**
 * Layer 1 cryptographic enhancements — SHA3-512, BLAKE3, chunk hashing.
 */
import type { CryptoEnhancementData } from '../../types/dna-enhancements.types';
import { dnaEnhancements } from '../../config/dna-enhancements';
import { computeChunkHashes, chunkHashSimilarity, computeSha3_512Hex } from './chunk-hash.service';
import { computeBlake3Hex } from './blake3.service';

export { computeBlake3Hex, computeChunkHashes, chunkHashSimilarity, computeSha3_512Hex };

export function generateCryptoEnhancements(buffer: Buffer): CryptoEnhancementData | undefined {
  if (!dnaEnhancements.enabled) return undefined;

  const out: CryptoEnhancementData = {};

  if (dnaEnhancements.layer1.sha3_512) {
    out.sha3_512 = computeSha3_512Hex(buffer);
  }

  if (dnaEnhancements.layer1.chunkHash) {
    const chunkSize = dnaEnhancements.layer1.chunkSizeBytes;
    out.chunkHashes = computeChunkHashes(buffer, chunkSize);
    out.chunkCount = out.chunkHashes.length;
    out.chunkSizeBytes = chunkSize;
  }

  return Object.keys(out).length ? out : undefined;
}

export function verifyCryptoEnhancements(
  probe: CryptoEnhancementData,
  stored: CryptoEnhancementData,
): number {
  const scores: number[] = [];

  if (probe.sha3_512 && stored.sha3_512) {
    scores.push(probe.sha3_512 === stored.sha3_512 ? 1 : 0);
  }

  if (probe.chunkHashes?.length && stored.chunkHashes?.length) {
    scores.push(chunkHashSimilarity(probe.chunkHashes, stored.chunkHashes));
  }

  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
