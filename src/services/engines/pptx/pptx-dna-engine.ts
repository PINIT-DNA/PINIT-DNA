/**
 * PINIT-DNA — PPTX DNA Engine
 *
 * Generates all 6 DNA fingerprint layers for PowerPoint presentations (.pptx).
 * PPTX is an OPC (Open Packaging Convention) ZIP container.
 *
 * L1 — Cryptographic : SHA-256 of raw bytes
 * L2 — Structural    : Slide count + text shapes per slide + total words
 * L3 — Perceptual    : SimHash of all slide text concatenated
 * L4 — Semantic      : Theme colors + font names + per-slide text hash
 * L5 — Metadata      : OPC core.xml (author, revision, dates) + slide count
 * L6 — Signature     : HMAC-SHA256 over all L1–L5 fingerprints
 */

import crypto from 'crypto';
import JSZip from 'jszip';
import { config } from '../../../config';
import { logger } from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';
import { FileInput } from '../../universal-file-router';
import { UniversalEngineResult, UniversalLayerResult } from '../../../types/universal-engine.types';
import { simHash64, computeHmac, sha256 } from '../base/text-utils';

// ─── XML helpers ──────────────────────────────────────────────────────────────

/** Extract all <a:t> text from PPTX slide XML */
function extractPptxText(xml: string): string {
  const parts: string[] = [];
  const re = /<a:t>([^<]*)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) parts.push(m[1]);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Extract named XML value */
function extractXmlValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:dc:|cp:|vt:)?${tag}[^>]*>([^<]*)<\\/`, 'i');
  const m = re.exec(xml);
  return m ? m[1].trim() || null : null;
}

/** Extract theme colors from theme XML */
function extractThemeColors(themeXml: string): string[] {
  const colors: string[] = [];
  const re = /val="([0-9A-Fa-f]{6})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(themeXml)) !== null) colors.push('#' + m[1].toUpperCase());
  return [...new Set(colors)].slice(0, 10);
}

/** Extract font names from theme XML */
function extractFontNames(themeXml: string): string[] {
  const fonts: string[] = [];
  const re = /typeface="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(themeXml)) !== null) {
    if (m[1] && !m[1].startsWith('+')) fonts.push(m[1]);
  }
  return [...new Set(fonts)];
}

// ─── Engine ───────────────────────────────────────────────────────────────────

interface SlideData {
  index: number;
  text: string;
  wordCount: number;
  textHash: string;
}

export class PptxDnaEngine {
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const layers: UniversalLayerResult[] = [];

    logger.info('PPTX DNA engine started', { dnaRecordId, file: file.originalName });

    let zip: JSZip | null = null;
    let slides: SlideData[] = [];
    let coreXml   = '';
    let appXml    = '';
    let themeXml  = '';
    let parseError: string | null = null;

    try {
      zip = await JSZip.loadAsync(file.buffer);

      // Core + App metadata
      const coreFile = zip.file('docProps/core.xml');
      const appFile  = zip.file('docProps/app.xml');
      coreXml = coreFile ? await coreFile.async('text') : '';
      appXml  = appFile  ? await appFile.async('text')  : '';

      // Theme (colors + fonts)
      const themeFile = zip.file('ppt/theme/theme1.xml');
      themeXml = themeFile ? await themeFile.async('text') : '';

      // Slides — ppt/slides/slide1.xml, slide2.xml, ...
      const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)?.[0] ?? '0');
          const numB = parseInt(b.match(/\d+/)?.[0] ?? '0');
          return numA - numB;
        });

      for (let i = 0; i < slideFiles.length; i++) {
        const slideFile = zip.file(slideFiles[i]);
        if (!slideFile) continue;
        const slideXml  = await slideFile.async('text');
        const text      = extractPptxText(slideXml);
        const wordCount = (text.match(/\S+/g) ?? []).length;
        slides.push({ index: i + 1, text, wordCount, textHash: sha256(text) });
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
      logger.warn('PPTX parse failed', { dnaRecordId, error: parseError });
    }

    // L1 always works
    layers.push(await this.runLayer(() => this.layer1(file.buffer)));

    if (parseError) {
      for (let i = 2; i <= 6; i++) {
        layers.push({ layer: i as UniversalLayerResult['layer'], name: 'structural',
          implementation: 'parse_failed', fingerprint: '', data: { error: parseError },
          success: false, processingMs: 0, error: `PPTX parse failed: ${parseError}` });
      }
    } else {
      const allText = slides.map(s => s.text).join(' ');
      layers.push(await this.runLayer(() => this.layer2(slides)));
      layers.push(await this.runLayer(() => this.layer3(allText)));
      layers.push(await this.runLayer(() => this.layer4(themeXml, slides)));
      layers.push(await this.runLayer(() => this.layer5(coreXml, appXml, slides.length)));
      const fingerprints = layers.filter(l => l.success).map(l => l.fingerprint).join('|');
      layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));
    }

    const successful = layers.filter(l => l.success).length;
    const status = successful === 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status, universalFingerprints: { layers } as object },
    });

    logger.info('PPTX DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return {
      dnaRecordId, fileType: 'PPTX', engineVersion: config.dna.engineVersion,
      schemaVersion: config.dna.schemaVersion, layers, status,
      totalProcessingMs: totalMs, generatedAt: new Date(),
    };
  }

  // ─── L1: Cryptographic ────────────────────────────────────────────────────

  private layer1(buffer: Buffer): UniversalLayerResult {
    const t = Date.now();
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return { layer: 1, name: 'cryptographic', implementation: 'sha256',
      fingerprint: sha256Hash, data: { sha256Hash },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L2: Structural ───────────────────────────────────────────────────────

  private layer2(slides: SlideData[]): UniversalLayerResult {
    const t = Date.now();
    const slideCount   = slides.length;
    const totalWords   = slides.reduce((s, sl) => s + sl.wordCount, 0);
    const avgWords     = slideCount > 0 ? Math.round(totalWords / slideCount) : 0;
    const wordsPerSlide = slides.map(s => ({ slide: s.index, wordCount: s.wordCount }));

    const data = { slideCount, totalWordCount: totalWords, avgWordsPerSlide: avgWords, wordsPerSlide };
    const fingerprint = sha256(`${slideCount}:${totalWords}:${wordsPerSlide.map(s => s.wordCount).join(',')}`);

    return { layer: 2, name: 'structural', implementation: 'slide_count_layout_hash',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L3: Perceptual ───────────────────────────────────────────────────────

  private layer3(allText: string): UniversalLayerResult {
    const t = Date.now();
    const normalized = allText.toLowerCase().replace(/\s+/g, ' ').trim();
    const hash64     = simHash64(normalized);
    const contentSig = sha256(normalized.slice(0, 8192));

    return { layer: 3, name: 'perceptual', implementation: 'slide_text_simhash',
      fingerprint: hash64,
      data: { simHash64: hash64, contentSignature: contentSig, totalTextLength: allText.length },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L4: Semantic ────────────────────────────────────────────────────────

  private layer4(themeXml: string, slides: SlideData[]): UniversalLayerResult {
    const t = Date.now();
    const colors   = extractThemeColors(themeXml);
    const fonts    = extractFontNames(themeXml);
    const slideHashes = slides.map(s => ({ slide: s.index, hash: s.textHash }));

    const data = { themeColors: colors, fontNames: fonts,
      slideTextHashes: slideHashes, slideCount: slides.length };
    const fingerprint = sha256([...colors, ...fonts].join('|'));

    return { layer: 4, name: 'semantic', implementation: 'theme_color_font_fingerprint',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L5: Metadata ────────────────────────────────────────────────────────

  private layer5(coreXml: string, appXml: string, slideCount: number): UniversalLayerResult {
    const t = Date.now();
    const data = {
      creator:         extractXmlValue(coreXml, 'creator'),
      lastModifiedBy:  extractXmlValue(coreXml, 'lastModifiedBy'),
      created:         extractXmlValue(coreXml, 'created'),
      modified:        extractXmlValue(coreXml, 'modified'),
      revision:        extractXmlValue(coreXml, 'revision'),
      application:     extractXmlValue(appXml,  'Application'),
      company:         extractXmlValue(appXml,  'Company'),
      appVersion:      extractXmlValue(appXml,  'AppVersion'),
      slideCount,
    };
    const fingerprint = sha256(JSON.stringify({
      creator: data.creator, revision: data.revision, created: data.created, slideCount,
    }));

    return { layer: 5, name: 'metadata', implementation: 'opc_core_properties',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L6: Signature ───────────────────────────────────────────────────────

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const hmac = computeHmac(`PPTX:${dnaRecordId}:${fingerprints}`, config.stego.signatureSecret);
    return { layer: 6, name: 'signature', implementation: 'hmac_sha256',
      fingerprint: hmac, data: { hmac, dnaRecordId, embedded: false },
      success: true, processingMs: Date.now() - t };
  }

  private async runLayer(fn: () => UniversalLayerResult | Promise<UniversalLayerResult>): Promise<UniversalLayerResult> {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('PPTX layer failed', { error });
      return { layer: 1, name: 'cryptographic', implementation: 'error',
        fingerprint: '', data: {}, success: false, processingMs: 0, error };
    }
  }
}
