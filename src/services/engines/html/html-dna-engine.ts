/**
 * PINIT-DNA — HTML DNA Engine
 *
 * L1–L6 for .html / .htm / .xhtml. RouteText then adds L7–L15 (15-layer DNA).
 *
 * L1 — Cryptographic : SHA-256 of raw bytes
 * L2 — Structural    : Tag tree / element counts / nesting depth
 * L3 — Perceptual    : SimHash of visible text (scripts/styles stripped)
 * L4 — Semantic      : Tag + word frequency distribution
 * L5 — Metadata      : doctype, charset, title, lang, encoding
 * L6 — Signature     : HMAC identity seal over L1–L5
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
  computeLayer6IdentitySeal,
  sha256,
} from '../base/text-utils';

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function visibleText(html: string): string {
  return stripScriptsAndStyles(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTags(html: string): string[] {
  const tags: string[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    tags.push(m[1].toLowerCase());
  }
  return tags;
}

function estimateMaxDepth(html: string): number {
  let depth = 0;
  let max = 0;
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const full = m[0];
    const name = m[1].toLowerCase();
    const isClose = full.startsWith('</');
    const isSelf =
      /\/\s*>$/.test(full) ||
      ['img', 'br', 'hr', 'meta', 'link', 'input', 'source', 'area', 'base', 'col', 'embed', 'wbr'].includes(name);
    if (isClose) {
      depth = Math.max(0, depth - 1);
    } else if (!isSelf) {
      depth += 1;
      if (depth > max) max = depth;
    }
  }
  return max;
}

export class HtmlDnaEngine {
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const raw = file.buffer.toString('utf-8');
    const layers: UniversalLayerResult[] = [];

    logger.info('HTML DNA engine started', { dnaRecordId, file: file.originalName });

    layers.push(await this.runLayer(() => this.layer1(file.buffer)));
    layers.push(await this.runLayer(() => this.layer2(raw)));
    layers.push(await this.runLayer(() => this.layer3(raw)));
    layers.push(await this.runLayer(() => this.layer4(raw)));
    layers.push(await this.runLayer(() => this.layer5(file.buffer, raw)));

    const fingerprints = layers.filter((l) => l.success).map((l) => l.fingerprint).join('|');
    layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));

    const successful = layers.filter((l) => l.success).length;
    const status = successful >= 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: {
        status,
        universalFingerprints: { layers } as object,
      },
    });

    logger.info('HTML DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return {
      dnaRecordId,
      fileType: 'HTML',
      engineVersion: config.dna.engineVersion,
      schemaVersion: config.dna.schemaVersion,
      layers,
      status,
      totalProcessingMs: totalMs,
      generatedAt: new Date(),
    };
  }

  private layer1(buffer: Buffer): UniversalLayerResult {
    const t = Date.now();
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const blake3Sim = crypto.createHash('sha256').update(sha256Hash + 'blake3').digest('hex');
    return {
      layer: 1,
      name: 'cryptographic',
      implementation: 'sha256_blake3sim',
      fingerprint: sha256Hash,
      data: { sha256Hash, blake3Hash: blake3Sim },
      success: true,
      processingMs: Date.now() - t,
    };
  }

  private layer2(html: string): UniversalLayerResult {
    const t = Date.now();
    const tags = extractTags(html);
    const tagCounts: Record<string, number> = {};
    for (const tag of tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;

    const uniqueTags = Object.keys(tagCounts).sort();
    const maxDepth = estimateMaxDepth(html);
    const scriptCount = (html.match(/<script\b/gi) ?? []).length;
    const styleCount = (html.match(/<style\b/gi) ?? []).length;
    const linkCount = (html.match(/<a\b/gi) ?? []).length;
    const imgCount = (html.match(/<img\b/gi) ?? []).length;
    const formCount = (html.match(/<form\b/gi) ?? []).length;
    const entropy = shannonEntropy(html);

    const metrics = {
      tagCount: tags.length,
      uniqueTagCount: uniqueTags.length,
      maxDepth,
      scriptCount,
      styleCount,
      linkCount,
      imgCount,
      formCount,
      entropy: Math.round(entropy * 10000) / 10000,
      tagHistogramTop: uniqueTags
        .map((tag) => ({ tag, count: tagCounts[tag] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 25),
    };

    const fingerprint = sha256(
      JSON.stringify({
        uniqueTags,
        maxDepth,
        scriptCount,
        styleCount,
        linkCount,
        imgCount,
        formCount,
        tagCount: tags.length,
      }),
    );

    return {
      layer: 2,
      name: 'structural',
      implementation: 'dom_tag_tree_structure_hash',
      fingerprint,
      data: metrics,
      success: true,
      processingMs: Date.now() - t,
    };
  }

  private layer3(html: string): UniversalLayerResult {
    const t = Date.now();
    const text = visibleText(html).toLowerCase();
    const hash64 = simHash64(text);
    const hash128 = simHash128(text);
    const contentSig = sha256(text.slice(0, 4096));

    return {
      layer: 3,
      name: 'perceptual',
      implementation: 'visible_text_simhash',
      fingerprint: hash64,
      data: {
        simHash64: hash64,
        simHash128: hash128,
        contentSignature: contentSig,
        visibleTextLength: text.length,
      },
      success: true,
      processingMs: Date.now() - t,
    };
  }

  private layer4(html: string): UniversalLayerResult {
    const t = Date.now();
    const tags = extractTags(html);
    const tagFreq: Record<string, number> = {};
    for (const tag of tags) tagFreq[tag] = (tagFreq[tag] ?? 0) + 1;
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    const words = visibleText(html).toLowerCase().match(/[a-z]{2,}/g) ?? [];
    const wordFreq: Record<string, number> = {};
    for (const w of words) wordFreq[w] = (wordFreq[w] ?? 0) + 1;
    const topWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));

    const data = {
      topTags,
      topWords,
      vocabulary: Object.keys(wordFreq).length,
      tagVocabulary: Object.keys(tagFreq).length,
    };
    const fingerprint = sha256(
      [
        ...topTags.map((t) => `${t.tag}:${t.count}`),
        ...topWords.map((w) => `${w.word}:${w.count}`),
      ].join(','),
    );

    return {
      layer: 4,
      name: 'semantic',
      implementation: 'tag_and_text_frequency',
      fingerprint,
      data,
      success: true,
      processingMs: Date.now() - t,
    };
  }

  private layer5(buffer: Buffer, html: string): UniversalLayerResult {
    const t = Date.now();
    const { encoding, hasBom } = detectEncoding(buffer);
    const lineEnding = detectLineEnding(html);
    const doctype = (html.match(/<!DOCTYPE\s+([^>\s]+)/i)?.[1] ?? '').toLowerCase();
    const charset =
      html.match(/<meta[^>]+charset=["']?([^"'>\s]+)/i)?.[1]?.toLowerCase() ??
      html.match(/charset=([^\s"';>]+)/i)?.[1]?.toLowerCase() ??
      '';
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const lang = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? '';
    const hasViewport = /name=["']viewport["']/i.test(html);

    const data = {
      encoding,
      hasBom,
      lineEnding,
      doctype,
      charset,
      title,
      lang,
      hasViewport,
      fileSize: buffer.length,
    };
    const fingerprint = sha256(JSON.stringify({ doctype, charset, title, lang, encoding, hasBom }));

    return {
      layer: 5,
      name: 'metadata',
      implementation: 'doctype_charset_title_meta',
      fingerprint,
      data,
      success: true,
      processingMs: Date.now() - t,
    };
  }

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const secret = config.stego.signatureSecret;
    const hmac = computeLayer6IdentitySeal('HTML', fingerprints, dnaRecordId, secret);
    return {
      layer: 6,
      name: 'signature',
      implementation: 'hmac_sha256',
      fingerprint: hmac,
      data: { hmac, dnaRecordId, embedded: false },
      success: true,
      processingMs: Date.now() - t,
    };
  }

  private async runLayer(fn: () => UniversalLayerResult): Promise<UniversalLayerResult> {
    try {
      return fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('HTML layer failed', { error });
      return {
        layer: 1,
        name: 'cryptographic',
        implementation: 'error',
        fingerprint: '',
        data: {},
        success: false,
        processingMs: 0,
        error,
      };
    }
  }
}
