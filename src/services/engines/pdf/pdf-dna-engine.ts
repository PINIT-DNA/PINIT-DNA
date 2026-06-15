/**
 * PINIT-DNA — PDF DNA Engine
 *
 * Generates all 6 DNA fingerprint layers for PDF files.
 *
 * L1 — Cryptographic : SHA-256 of raw bytes
 * L2 — Structural    : Page count + words-per-page distribution + layout hash
 * L3 — Perceptual    : SimHash of full extracted text
 * L4 — Semantic      : Top-20 words + text density + language fingerprint
 * L5 — Metadata      : Author, Creator, Producer, dates, PDF version
 * L6 — Signature     : HMAC-SHA256 over all L1–L5 fingerprints
 */

/* eslint-disable @typescript-eslint/no-var-requires */
import crypto from 'crypto';
import { config } from '../../../config';
import { logger } from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';
import { FileInput } from '../../universal-file-router';
import { UniversalEngineResult, UniversalLayerResult } from '../../../types/universal-engine.types';
import { simHash64, computeHmac, sha256, shannonEntropy } from '../base/text-utils';

// pdf-parse v1.1.1 — exports a function directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfParseResult = { numpages: number; text: string; info: Record<string, unknown>; metadata: unknown; version: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse: (buffer: Buffer, options?: any) => Promise<PdfParseResult> = require('pdf-parse');

// ─── Engine ───────────────────────────────────────────────────────────────────

export class PdfDnaEngine {
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const layers: UniversalLayerResult[] = [];

    logger.info('PDF DNA engine started', { dnaRecordId, file: file.originalName });

    // Parse PDF once — shared across layers
    let pdfData: PdfParseResult | null = null;
    let parseError: string | null = null;

    try {
      pdfData = await pdfParse(file.buffer, { max: 0 }); // max:0 = parse all pages
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
      logger.warn('PDF parse failed', { dnaRecordId, error: parseError });
    }

    // L1: raw bytes hash + normalized text hash (once text is available)
    const extractedText = pdfData?.text ?? '';
    layers.push(await this.runLayer(() => this.layer1(file.buffer, extractedText)));

    if (!pdfData) {
      // Partial DNA: only L1 succeeded
      for (let i = 2; i <= 6; i++) {
        layers.push({
          layer: i as UniversalLayerResult['layer'], name: 'structural',
          implementation: 'parse_failed', fingerprint: '', data: { error: parseError },
          success: false, processingMs: 0, error: `PDF parse failed: ${parseError}`,
        });
      }
    } else {
      const text = pdfData.text ?? '';
      layers.push(await this.runLayer(() => this.layer2(pdfData!)));
      layers.push(await this.runLayer(() => this.layer3(text)));
      layers.push(await this.runLayer(() => this.layer4(text)));
      layers.push(await this.runLayer(() => this.layer5(pdfData!)));
      const fingerprints = layers.filter(l => l.success).map(l => l.fingerprint).join('|');
      layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));
    }

    const successful = layers.filter(l => l.success).length;
    const status = successful >= 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    // Persist L1 hashes to CryptoLayer table so Intelligence Report can read them
    const l1 = layers.find(l => l.layer === 1 && l.success);
    if (l1?.data) {
      const d = l1.data as { sha256Hash: string; normalizedHash: string };
      await prisma.cryptoLayer.upsert({
        where:  { dnaRecordId },
        create: { dnaRecordId, sha256Hash: d.sha256Hash, normalizedHash: d.normalizedHash, blake3Hash: null },
        update: { sha256Hash: d.sha256Hash, normalizedHash: d.normalizedHash },
      });
    }

    // Save extracted text as OCR record — pdf-parse gives us the text for free
    if (extractedText.trim().length > 0) {
      const wordCount = (extractedText.match(/\S+/g) ?? []).length;
      await prisma.ocrRecord.upsert({
        where:  { dnaRecordId },
        create: {
          dnaRecordId,
          extractedText,
          wordCount,
          confidence:  1.0,
          language:    'eng',
          processingMs: 0,
          indexed:     false,
          ocrStatus:   'COMPLETE',
        },
        update: { extractedText, wordCount, ocrStatus: 'COMPLETE', indexed: false },
      });
    }

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status, universalFingerprints: { layers } as object },
    });

    logger.info('PDF DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return {
      dnaRecordId, fileType: 'PDF', engineVersion: config.dna.engineVersion,
      schemaVersion: config.dna.schemaVersion, layers, status,
      totalProcessingMs: totalMs, generatedAt: new Date(),
    };
  }

  // ─── L1: Cryptographic ────────────────────────────────────────────────────

  private layer1(buffer: Buffer, text: string): UniversalLayerResult {
    const t = Date.now();
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Normalized hash: SHA-256 of cleaned text content
    // Survives font changes, margin tweaks, re-exports — only changes if text changes
    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedHash = normalizedText.length > 0
      ? crypto.createHash('sha256').update(normalizedText, 'utf8').digest('hex')
      : sha256Hash; // fallback to file hash if no text extracted

    return {
      layer: 1, name: 'cryptographic', implementation: 'sha256',
      fingerprint: sha256Hash, data: { sha256Hash, normalizedHash },
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L2: Structural ───────────────────────────────────────────────────────

  private layer2(pdf: PdfParseResult): UniversalLayerResult {
    const t = Date.now();
    const pages = pdf.numpages;
    const text  = pdf.text ?? '';

    // Approximate words per page by splitting full text evenly
    const words      = text.match(/\S+/g) ?? [];
    const totalWords = words.length;
    const avgWordsPerPage = pages > 0 ? Math.round(totalWords / pages) : 0;

    // Split text into page-sized chunks for per-page word count approximation
    const chunkSize = Math.ceil(text.length / Math.max(pages, 1));
    const wordsPerPage = Array.from({ length: pages }, (_, i) => {
      const chunk = text.slice(i * chunkSize, (i + 1) * chunkSize);
      return (chunk.match(/\S+/g) ?? []).length;
    });

    const data = { pageCount: pages, totalWordCount: totalWords,
      avgWordsPerPage, wordsPerPage };
    const fingerprint = sha256(`${pages}:${avgWordsPerPage}:${wordsPerPage.join(',')}`);

    return {
      layer: 2, name: 'structural', implementation: 'page_layout_tree_hash',
      fingerprint, data, success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L3: Perceptual ───────────────────────────────────────────────────────

  private layer3(text: string): UniversalLayerResult {
    const t = Date.now();
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const hash64     = simHash64(normalized);
    const contentSig = sha256(normalized.slice(0, 8192));

    return {
      layer: 3, name: 'perceptual', implementation: 'text_content_simhash',
      fingerprint: hash64,
      data: { simHash64: hash64, contentSignature: contentSig, textLength: text.length },
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L4: Semantic ────────────────────────────────────────────────────────

  private layer4(text: string): UniversalLayerResult {
    const t = Date.now();
    const words = text.toLowerCase().match(/[a-z]{2,}/g) ?? [];
    const freq: Record<string, number> = {};
    for (const w of words) freq[w] = (freq[w] ?? 0) + 1;

    const topWords = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));

    const vocabulary   = Object.keys(freq).length;
    const entropy      = shannonEntropy(text.slice(0, 10000));
    const numericCount = (text.match(/\d/g) ?? []).length;
    const numericRatio = text.length ? Math.round(numericCount / text.length * 10000) / 10000 : 0;

    const data = { topWords, vocabulary, entropy: Math.round(entropy * 10000) / 10000,
      numericRatio, wordCount: words.length };
    const fingerprint = sha256(topWords.map(w => `${w.word}:${w.count}`).join(','));

    return {
      layer: 4, name: 'semantic', implementation: 'top_words_text_density',
      fingerprint, data, success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L5: Metadata ────────────────────────────────────────────────────────

  private layer5(pdf: PdfParseResult): UniversalLayerResult {
    const t = Date.now();
    const info = pdf.info ?? {};
    const data = {
      author:       (info['Author']       as string | null) ?? null,
      creator:      (info['Creator']      as string | null) ?? null,
      producer:     (info['Producer']     as string | null) ?? null,
      creationDate: (info['CreationDate'] as string | null) ?? null,
      modDate:      (info['ModDate']      as string | null) ?? null,
      pdfVersion:   pdf.version ?? null,
      pageCount:    pdf.numpages,
    };
    const fingerprint = sha256(JSON.stringify({
      author: data.author, creator: data.creator, pdfVersion: data.pdfVersion,
    }));

    return {
      layer: 5, name: 'metadata', implementation: 'pdf_metadata_provenance',
      fingerprint, data, success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L6: Signature ───────────────────────────────────────────────────────

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const hmac = computeHmac(`PDF:${dnaRecordId}:${fingerprints}`, config.stego.signatureSecret);
    return {
      layer: 6, name: 'signature', implementation: 'hmac_sha256',
      fingerprint: hmac, data: { hmac, dnaRecordId, embedded: false },
      success: true, processingMs: Date.now() - t,
    };
  }

  private async runLayer(fn: () => UniversalLayerResult): Promise<UniversalLayerResult> {
    try {
      return fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('PDF layer failed', { error });
      return { layer: 1, name: 'cryptographic', implementation: 'error',
        fingerprint: '', data: {}, success: false, processingMs: 0, error };
    }
  }
}
