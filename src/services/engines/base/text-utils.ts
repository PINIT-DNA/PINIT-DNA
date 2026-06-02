/**
 * PINIT-DNA — Text Engine Utilities
 *
 * Zero-dependency helpers shared by the TXT, CSV, and JSON DNA engines:
 *   - SimHash  (64-bit and 128-bit perceptual hash for text content)
 *   - Hamming distance + similarity score
 *   - Shannon entropy
 *   - Encoding / BOM detection
 *   - Line-ending detection
 *   - HMAC-SHA256 (Layer 6 signature)
 */

import crypto from 'crypto';

// ─── SimHash ──────────────────────────────────────────────────────────────────

/**
 * Compute a 64-bit SimHash of text content.
 * Returns a 16-char hex string.
 *
 * Similar documents (with minor edits) will have a low Hamming distance.
 */
export function simHash64(text: string): string {
  return computeSimHash(text, 64);
}

/**
 * Compute a 128-bit SimHash of text content.
 * Returns a 32-char hex string.
 */
export function simHash128(text: string): string {
  return computeSimHash(text, 128);
}

function computeSimHash(text: string, bits: number): string {
  // Tokenise: lowercase words only
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const v = new Array(bits).fill(0);

  for (const token of tokens) {
    // Hash the token to `bits` bits
    const digest = crypto.createHash('sha256').update(token).digest('hex');
    // Use as many hex chars as needed to cover `bits` bits
    const hexLen = Math.ceil(bits / 4);
    const h = BigInt('0x' + digest.slice(0, hexLen).padEnd(hexLen, '0'));

    for (let i = 0; i < bits; i++) {
      if ((h >> BigInt(i)) & BigInt(1)) {
        v[i]++;
      } else {
        v[i]--;
      }
    }
  }

  let fingerprint = BigInt(0);
  for (let i = 0; i < bits; i++) {
    if (v[i] > 0) fingerprint |= BigInt(1) << BigInt(i);
  }

  const hexLen = bits / 4;
  return fingerprint.toString(16).padStart(hexLen, '0');
}

/**
 * Hamming distance between two SimHash hex strings of the same length.
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return a.length * 4; // max distance
  let xor = BigInt('0x' + a) ^ BigInt('0x' + b);
  let dist = 0;
  while (xor > BigInt(0)) {
    dist += Number(xor & BigInt(1));
    xor >>= BigInt(1);
  }
  return dist;
}

/**
 * Similarity score [0,1] from SimHash strings.
 * 1.0 = identical content, 0.0 = completely different.
 */
export function simHashSimilarity(a: string, b: string): number {
  const bits = a.length * 4;
  const dist = hammingDistance(a, b);
  return 1 - dist / bits;
}

// ─── Shannon Entropy ──────────────────────────────────────────────────────────

/**
 * Shannon entropy of a string (bits per character, 0–8 range).
 * High entropy → random/compressed. Low entropy → repetitive.
 */
export function shannonEntropy(text: string): number {
  if (!text) return 0;
  const freq: Record<string, number> = {};
  for (const ch of text) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  const len = text.length;
  return -Object.values(freq).reduce((sum, count) => {
    const p = count / len;
    return sum + p * Math.log2(p);
  }, 0);
}

// ─── Encoding / BOM detection ─────────────────────────────────────────────────

export type TextEncoding = 'utf-8' | 'utf-16-le' | 'utf-16-be' | 'utf-32-le' | 'utf-32-be' | 'ascii' | 'binary';

/**
 * Detect text encoding by inspecting BOM bytes or byte patterns.
 * Falls back to 'utf-8' for most plain text files.
 */
export function detectEncoding(buffer: Buffer): { encoding: TextEncoding; hasBom: boolean } {
  // Check BOM sequences
  if (buffer[0] === 0xff && buffer[1] === 0xfe && buffer[2] === 0x00 && buffer[3] === 0x00) {
    return { encoding: 'utf-32-le', hasBom: true };
  }
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xfe && buffer[3] === 0xff) {
    return { encoding: 'utf-32-be', hasBom: true };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { encoding: 'utf-16-le', hasBom: true };
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { encoding: 'utf-16-be', hasBom: true };
  }
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { encoding: 'utf-8', hasBom: true };
  }

  // Heuristic: check for null bytes (indicates multi-byte encoding)
  const nullCount = [...buffer.slice(0, 512)].filter((b) => b === 0).length;
  if (nullCount > 0) return { encoding: 'utf-16-le', hasBom: false };

  // Check for non-ASCII bytes
  const nonAscii = [...buffer.slice(0, 512)].filter((b) => b > 127).length;
  if (nonAscii === 0) return { encoding: 'ascii', hasBom: false };

  return { encoding: 'utf-8', hasBom: false };
}

// ─── Line-ending detection ────────────────────────────────────────────────────

export type LineEnding = 'CRLF' | 'LF' | 'CR' | 'MIXED' | 'NONE';

export function detectLineEnding(content: string): LineEnding {
  const crlfCount = (content.match(/\r\n/g) ?? []).length;
  const lfCount   = (content.match(/(?<!\r)\n/g) ?? []).length;
  const crCount   = (content.match(/\r(?!\n)/g) ?? []).length;

  const total = crlfCount + lfCount + crCount;
  if (total === 0) return 'NONE';
  if (crlfCount === total) return 'CRLF';
  if (lfCount === total)   return 'LF';
  if (crCount === total)   return 'CR';
  return 'MIXED';
}

// ─── HMAC signature ───────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 of a payload string.
 * Used for Layer 6 signatures across all Phase 1 engines.
 */
export function computeHmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// ─── Generic hash ─────────────────────────────────────────────────────────────

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ─── Cosine similarity for numeric vectors ────────────────────────────────────

/**
 * Cosine similarity between two numeric arrays.
 * Used by L4 semantic layer comparison.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
