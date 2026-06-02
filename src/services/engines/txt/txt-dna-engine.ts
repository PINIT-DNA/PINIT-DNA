/**
 * PINIT-DNA — TXT DNA Engine
 *
 * Generates all 6 DNA fingerprint layers for plain text files.
 *
 * L1 — Cryptographic   : SHA-256 + BLAKE3-simulated (double SHA-256)
 * L2 — Structural      : Line/word/char counts + Shannon entropy
 * L3 — Perceptual      : 64-bit + 128-bit SimHash of normalised content
 * L4 — Semantic        : Top-20 word frequency distribution
 * L5 — Metadata        : Encoding, BOM, line-ending, file size
 * L6 — Signature       : HMAC-SHA256 over all L1–L5 fingerprints
 */

import crypto from 'crypto';
import { config } from '../../../config';
import { logger } from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';
import { FileInput } from '../../universal-file-router';
import { UniversalEngineResult, UniversalLayerResult } from '../../../types/universal-engine.types';
import {
  simHash64,
  simHash128,
  shannonEntropy,
  detectEncoding,
  detectLineEnding,
  computeHmac,
  sha256,
} from '../base/text-utils';

export class TxtDnaEngine {
  /**
   * Run all 6 layers on a plain text file.
   * Failures in individual layers do NOT abort the pipeline.
   */
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const content = file.buffer.toString('utf-8');
    const layers: UniversalLayerResult[] = [];

    logger.info('TXT DNA engine started', { dnaRecordId, file: file.originalName });

    // ── Layer 1: Cryptographic ────────────────────────────────────────────────
    layers.push(await this.runLayer(() => this.layer1(file.buffer)));

    // ── Layer 2: Structural ───────────────────────────────────────────────────
    layers.push(await this.runLayer(() => this.layer2(content)));

    // ── Layer 3: Perceptual ───────────────────────────────────────────────────
    layers.push(await this.runLayer(() => this.layer3(content)));

    // ── Layer 4: Semantic ─────────────────────────────────────────────────────
    layers.push(await this.runLayer(() => this.layer4(content)));

    // ── Layer 5: Metadata ─────────────────────────────────────────────────────
    layers.push(await this.runLayer(() => this.layer5(file.buffer, content)));

    // ── Layer 6: Signature ────────────────────────────────────────────────────
    const fingerprints = layers.filter(l => l.success).map(l => l.fingerprint).join('|');
    layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));

    const successful = layers.filter(l => l.success).length;
    const status = successful === 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    // ── Persist ───────────────────────────────────────────────────────────────
    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: {
        status,
        universalFingerprints: { layers } as object,
      },
    });

    logger.info('TXT DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return {
      dnaRecordId,
      fileType: 'TXT',
      engineVersion: config.dna.engineVersion,
      schemaVersion: config.dna.schemaVersion,
      layers,
      status,
      totalProcessingMs: totalMs,
      generatedAt: new Date(),
    };
  }

  // ─── L1: Cryptographic ────────────────────────────────────────────────────

  private layer1(buffer: Buffer): UniversalLayerResult {
    const t = Date.now();
    const sha256Hash  = crypto.createHash('sha256').update(buffer).digest('hex');
    // BLAKE3 approximation: double-SHA256 with a different init (placeholder)
    const blake3Sim   = crypto.createHash('sha256').update(sha256Hash + 'blake3').digest('hex');
    const fingerprint = sha256Hash;

    return {
      layer: 1, name: 'cryptographic',
      implementation: 'sha256_blake3sim',
      fingerprint,
      data: { sha256Hash, blake3Hash: blake3Sim },
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L2: Structural ───────────────────────────────────────────────────────

  private layer2(content: string): UniversalLayerResult {
    const t = Date.now();
    const lines     = content.split(/\r?\n/);
    const words     = content.match(/\S+/g) ?? [];
    const chars     = content.length;
    const emptyLines = lines.filter(l => l.trim() === '').length;
    const lineLengths = lines.map(l => l.length);
    const avgLineLen  = lineLengths.length
      ? lineLengths.reduce((a, b) => a + b, 0) / lineLengths.length
      : 0;
    const longestLine = Math.max(0, ...lineLengths);
    const entropy     = shannonEntropy(content);
    const emptyRatio  = lines.length > 0 ? emptyLines / lines.length : 0;

    const metrics = { lineCount: lines.length, wordCount: words.length, charCount: chars,
      avgLineLength: Math.round(avgLineLen * 100) / 100, longestLine, emptyLineRatio:
      Math.round(emptyRatio * 1000) / 1000, entropy: Math.round(entropy * 10000) / 10000 };

    const fingerprint = sha256(JSON.stringify(metrics));

    return {
      layer: 2, name: 'structural',
      implementation: 'line_word_char_entropy',
      fingerprint, data: metrics,
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L3: Perceptual ───────────────────────────────────────────────────────

  private layer3(content: string): UniversalLayerResult {
    const t = Date.now();
    // Normalize: lowercase, collapse whitespace
    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
    const hash64  = simHash64(normalized);
    const hash128 = simHash128(normalized);
    // Content signature: SHA-256 of normalised first 4KB (fast near-dup check)
    const contentSig = sha256(normalized.slice(0, 4096));

    return {
      layer: 3, name: 'perceptual',
      implementation: 'simhash_64_128',
      fingerprint: hash64,
      data: { simHash64: hash64, simHash128: hash128, contentSignature: contentSig },
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L4: Semantic ─────────────────────────────────────────────────────────

  private layer4(content: string): UniversalLayerResult {
    const t = Date.now();
    const words = content.toLowerCase().match(/[a-z]{2,}/g) ?? [];

    // Word frequency map
    const freq: Record<string, number> = {};
    for (const w of words) freq[w] = (freq[w] ?? 0) + 1;

    // Top 20 words
    const topWords = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));

    const vocabulary    = Object.keys(freq).length;
    const avgWordLen    = words.length
      ? words.reduce((s, w) => s + w.length, 0) / words.length : 0;
    const punctCount    = (content.match(/[.,!?;:'"()\-]/g) ?? []).length;
    const numericCount  = (content.match(/\d/g) ?? []).length;
    const punctRatio    = content.length ? punctCount / content.length : 0;
    const numericRatio  = content.length ? numericCount / content.length : 0;

    const data = { topWords, vocabulary, avgWordLength: Math.round(avgWordLen * 100) / 100,
      punctuationRatio: Math.round(punctRatio * 10000) / 10000,
      numericRatio: Math.round(numericRatio * 10000) / 10000 };

    // Fingerprint: hash of top-20 word+count pairs
    const fingerprint = sha256(topWords.map(w => `${w.word}:${w.count}`).join(','));

    return {
      layer: 4, name: 'semantic',
      implementation: 'word_frequency_distribution',
      fingerprint, data,
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L5: Metadata ─────────────────────────────────────────────────────────

  private layer5(buffer: Buffer, content: string): UniversalLayerResult {
    const t = Date.now();
    const { encoding, hasBom } = detectEncoding(buffer);
    const lineEnding = detectLineEnding(content);
    const lineCount  = content.split(/\r?\n/).length;
    const wordCount  = (content.match(/\S+/g) ?? []).length;

    const data = { encoding, hasBom, lineEnding, fileSize: buffer.length,
      lineCount, wordCount };

    const fingerprint = sha256(JSON.stringify({ encoding, hasBom, lineEnding }));

    return {
      layer: 5, name: 'metadata',
      implementation: 'encoding_lineending_meta',
      fingerprint, data,
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L6: Signature ────────────────────────────────────────────────────────

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const secret  = config.stego.signatureSecret;
    const payload = `TXT:${dnaRecordId}:${fingerprints}`;
    const hmac    = computeHmac(payload, secret);

    return {
      layer: 6, name: 'signature',
      implementation: 'hmac_sha256',
      fingerprint: hmac,
      data: { hmac, dnaRecordId, embedded: false,
        note: 'Phase 1: HMAC stored in DB. Zero-width embedding planned for Phase 2.' },
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── Error-safe layer runner ──────────────────────────────────────────────

  private async runLayer(fn: () => UniversalLayerResult): Promise<UniversalLayerResult> {
    try {
      return fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('TXT layer failed', { error });
      return { layer: 1, name: 'cryptographic', implementation: 'error',
        fingerprint: '', data: {}, success: false, processingMs: 0, error };
    }
  }
}
