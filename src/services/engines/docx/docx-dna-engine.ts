/**
 * PINIT-DNA — DOCX DNA Engine
 *
 * Generates all 6 DNA fingerprint layers for Word documents (.docx).
 * DOCX is an OPC (Open Packaging Convention) ZIP container.
 *
 * L1 — Cryptographic : SHA-256 of raw bytes
 * L2 — Structural    : Paragraph/table/heading count + structure hash
 * L3 — Perceptual    : SimHash of body text
 * L4 — Semantic      : Heading list + style names + top words
 * L5 — Metadata      : OPC core.xml (author, revision, dates, company)
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

/** Extract all <w:t> text node values from OOXML word document XML */
function extractDocxText(xml: string): string {
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) parts.push(m[1]);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Extract a named XML element value (handles single and multi-line) */
function extractXmlValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:dc:|cp:|vt:)?${tag}[^>]*>([^<]*)<\\/`, 'i');
  const m = re.exec(xml);
  return m ? m[1].trim() || null : null;
}

/** Count occurrences of an XML element */
function countXmlTag(xml: string, tag: string): number {
  return (xml.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
}

/** Extract heading text from paragraph style runs */
function extractHeadings(xml: string): string[] {
  const headings: string[] = [];
  // Match paragraphs with Heading style
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let para: RegExpExecArray | null;
  while ((para = paraRe.exec(xml)) !== null) {
    const paraXml = para[0];
    if (/<w:pStyle\s+w:val="Heading\d"/i.test(paraXml)) {
      const text = extractDocxText(paraXml);
      if (text) headings.push(text);
    }
  }
  return headings;
}

/** Extract style names used in the document */
function extractStyles(xml: string): string[] {
  const styles = new Set<string>();
  const re = /<w:pStyle\s+w:val="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) styles.add(m[1]);
  return [...styles].sort();
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DocxDnaEngine {
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const layers: UniversalLayerResult[] = [];

    logger.info('DOCX DNA engine started', { dnaRecordId, file: file.originalName });

    // Open ZIP / OPC container
    let zip: JSZip | null = null;
    let documentXml = '';
    let coreXml     = '';
    let appXml      = '';
    let parseError: string | null = null;

    try {
      zip = await JSZip.loadAsync(file.buffer);

      const docFile  = zip.file('word/document.xml');
      const coreFile = zip.file('docProps/core.xml');
      const appFile  = zip.file('docProps/app.xml');

      documentXml = docFile  ? await docFile.async('text')  : '';
      coreXml     = coreFile ? await coreFile.async('text') : '';
      appXml      = appFile  ? await appFile.async('text')  : '';
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
      logger.warn('DOCX parse failed', { dnaRecordId, error: parseError });
    }

    // L1 always works
    layers.push(await this.runLayer(() => this.layer1(file.buffer)));

    if (parseError) {
      for (let i = 2; i <= 6; i++) {
        layers.push({ layer: i as UniversalLayerResult['layer'], name: 'structural',
          implementation: 'parse_failed', fingerprint: '', data: { error: parseError },
          success: false, processingMs: 0, error: `DOCX parse failed: ${parseError}` });
      }
    } else {
      const bodyText = extractDocxText(documentXml);
      layers.push(await this.runLayer(() => this.layer2(documentXml, bodyText)));
      layers.push(await this.runLayer(() => this.layer3(bodyText)));
      layers.push(await this.runLayer(() => this.layer4(documentXml, bodyText)));
      layers.push(await this.runLayer(() => this.layer5(coreXml, appXml)));
      const fingerprints = layers.filter(l => l.success).map(l => l.fingerprint).join('|');
      layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));
    }

    const successful = layers.filter(l => l.success).length;
    const status = successful >= 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status, universalFingerprints: { layers } as object },
    });

    logger.info('DOCX DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return {
      dnaRecordId, fileType: 'DOCX', engineVersion: config.dna.engineVersion,
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

  private layer2(xml: string, bodyText: string): UniversalLayerResult {
    const t = Date.now();
    const paragraphs = countXmlTag(xml, 'w:p');
    const tables     = countXmlTag(xml, 'w:tbl');
    const rows       = countXmlTag(xml, 'w:tr');
    const headings   = extractHeadings(xml);
    const words      = (bodyText.match(/\S+/g) ?? []).length;

    const data = { paragraphCount: paragraphs, tableCount: tables,
      tableRowCount: rows, headingCount: headings.length,
      wordCount: words, headingTexts: headings.slice(0, 20) };
    const fingerprint = sha256(`${paragraphs}:${tables}:${headings.length}:${words}`);

    return { layer: 2, name: 'structural', implementation: 'paragraph_table_heading_hash',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L3: Perceptual ───────────────────────────────────────────────────────

  private layer3(bodyText: string): UniversalLayerResult {
    const t = Date.now();
    const normalized = bodyText.toLowerCase().replace(/\s+/g, ' ').trim();
    const hash64     = simHash64(normalized);
    const contentSig = sha256(normalized.slice(0, 8192));

    return { layer: 3, name: 'perceptual', implementation: 'body_text_simhash',
      fingerprint: hash64,
      data: { simHash64: hash64, contentSignature: contentSig, textLength: bodyText.length },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L4: Semantic ────────────────────────────────────────────────────────

  private layer4(xml: string, bodyText: string): UniversalLayerResult {
    const t = Date.now();
    const styles   = extractStyles(xml);
    const headings = extractHeadings(xml);
    const words    = bodyText.toLowerCase().match(/[a-z]{2,}/g) ?? [];
    const freq: Record<string, number> = {};
    for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
    const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1])
      .slice(0, 20).map(([word, count]) => ({ word, count }));

    const data = { stylesUsed: styles, headingTexts: headings,
      topWords, vocabulary: Object.keys(freq).length };
    const fingerprint = sha256([...styles, ...headings].join('|'));

    return { layer: 4, name: 'semantic', implementation: 'heading_style_fingerprint',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L5: Metadata ────────────────────────────────────────────────────────

  private layer5(coreXml: string, appXml: string): UniversalLayerResult {
    const t = Date.now();
    const data = {
      creator:          extractXmlValue(coreXml, 'creator'),
      lastModifiedBy:   extractXmlValue(coreXml, 'lastModifiedBy'),
      created:          extractXmlValue(coreXml, 'created'),
      modified:         extractXmlValue(coreXml, 'modified'),
      revision:         extractXmlValue(coreXml, 'revision'),
      company:          extractXmlValue(appXml, 'Company'),
      application:      extractXmlValue(appXml, 'Application'),
      appVersion:       extractXmlValue(appXml, 'AppVersion'),
    };
    const fingerprint = sha256(JSON.stringify({
      creator: data.creator, revision: data.revision, created: data.created,
    }));

    return { layer: 5, name: 'metadata', implementation: 'opc_core_properties',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L6: Signature ───────────────────────────────────────────────────────

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const hmac = computeHmac(`DOCX:${dnaRecordId}:${fingerprints}`, config.stego.signatureSecret);
    return { layer: 6, name: 'signature', implementation: 'hmac_sha256',
      fingerprint: hmac, data: { hmac, dnaRecordId, embedded: false },
      success: true, processingMs: Date.now() - t };
  }

  private async runLayer(fn: () => UniversalLayerResult | Promise<UniversalLayerResult>): Promise<UniversalLayerResult> {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('DOCX layer failed', { error });
      return { layer: 1, name: 'cryptographic', implementation: 'error',
        fingerprint: '', data: {}, success: false, processingMs: 0, error };
    }
  }
}
