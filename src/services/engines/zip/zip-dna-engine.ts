/**
 * PINIT-DNA — ZIP DNA Engine  (Phase 3)
 *
 * L1 — Cryptographic : SHA-256 of raw bytes
 * L2 — Structural    : Entry count, dir/file split, depth, directory tree hash
 * L3 — Perceptual    : SimHash of sorted entry-name list
 * L4 — Semantic      : File-extension distribution profile
 * L5 — Metadata      : Compression methods, ZIP comment, date range of entries
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pathDepth(p: string): number {
  return p.split('/').filter(Boolean).length;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '(no ext)';
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class ZipDnaEngine {
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const layers: UniversalLayerResult[] = [];

    logger.info('ZIP DNA engine started', { dnaRecordId, file: file.originalName });

    let zip: JSZip | null = null;
    let parseError: string | null = null;

    try {
      zip = await JSZip.loadAsync(file.buffer);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
      logger.warn('ZIP parse failed', { dnaRecordId, error: parseError });
    }

    layers.push(await this.runLayer(() => this.layer1(file.buffer)));

    if (parseError || !zip) {
      for (let i = 2; i <= 6; i++) {
        layers.push({ layer: i as UniversalLayerResult['layer'], name: 'structural',
          implementation: 'parse_failed', fingerprint: '', data: { error: parseError },
          success: false, processingMs: 0, error: `ZIP parse failed: ${parseError}` });
      }
    } else {
      const entries = Object.values(zip.files);
      layers.push(await this.runLayer(() => this.layer2(zip!, entries)));
      layers.push(await this.runLayer(() => this.layer3(entries)));
      layers.push(await this.runLayer(() => this.layer4(entries)));
      layers.push(await this.runLayer(async () => this.layer5(zip!, entries)));
      const fingerprints = layers.filter(l => l.success).map(l => l.fingerprint).join('|');
      layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));
    }

    const successful = layers.filter(l => l.success).length;
    const status = successful === 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    // Deep-clone through JSON to strip any non-serializable values (Sets, Dates, BigInt, etc.)
    let fingerprints: object;
    try {
      fingerprints = JSON.parse(JSON.stringify({ layers }, (_key, val) => {
        if (val instanceof Set) return [...val];
        if (val instanceof Map) return Object.fromEntries(val);
        if (typeof val === 'bigint') return val.toString();
        if (val instanceof Buffer) return val.toString('hex');
        return val;
      }));
    } catch (jsonErr) {
      logger.error('ZIP fingerprints JSON serialization failed', { dnaRecordId, error: String(jsonErr) });
      fingerprints = { layers: layers.map(l => ({ layer: l.layer, name: l.name, success: l.success, fingerprint: l.fingerprint })) };
    }

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status, universalFingerprints: fingerprints },
    });

    logger.info('ZIP DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return { dnaRecordId, fileType: 'ZIP', engineVersion: config.dna.engineVersion,
      schemaVersion: config.dna.schemaVersion, layers, status,
      totalProcessingMs: totalMs, generatedAt: new Date() };
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

  private layer2(_zip: JSZip, entries: JSZip.JSZipObject[]): UniversalLayerResult {
    const t = Date.now();
    const dirs  = entries.filter(e => e.dir);
    const files = entries.filter(e => !e.dir);
    const maxDepth = Math.max(0, ...entries.map(e => pathDepth(e.name)));

    // Sorted entry names for structural fingerprint
    const sortedNames = entries.map(e => e.name).sort();
    const fingerprint = sha256(sortedNames.join('\n'));

    const data = {
      entryCount:  entries.length,
      dirCount:    dirs.length,
      fileCount:   files.length,
      maxDepth,
      topLevelEntries: entries.filter(e => pathDepth(e.name) === 1).map(e => e.name).sort(),
    };

    return { layer: 2, name: 'structural', implementation: 'entry_directory_tree_hash',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L3: Perceptual ───────────────────────────────────────────────────────

  private layer3(entries: JSZip.JSZipObject[]): UniversalLayerResult {
    const t = Date.now();
    const sortedNames = entries.map(e => e.name).sort().join(' ');
    const hash64      = simHash64(sortedNames);
    const listHash    = sha256(sortedNames);

    return { layer: 3, name: 'perceptual', implementation: 'sorted_entry_simhash',
      fingerprint: hash64,
      data: { simHash64: hash64, entryListHash: listHash, entryCount: entries.length },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L4: Semantic ─────────────────────────────────────────────────────────

  private layer4(entries: JSZip.JSZipObject[]): UniversalLayerResult {
    const t = Date.now();
    const files = entries.filter(e => !e.dir);
    const extDist: Record<string, number> = {};

    for (const f of files) {
      const ext = getExtension(f.name);
      extDist[ext] = (extDist[ext] ?? 0) + 1;
    }

    const topExtensions = Object.entries(extDist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([ext, count]) => ({ ext, count }));

    const textExts  = new Set(['.txt','.md','.json','.js','.ts','.py','.html','.css','.xml','.csv','.yaml','.yml','.toml','.ini','.cfg','.sh','.bat']);
    const textFiles = files.filter(f => textExts.has(getExtension(f.name))).length;
    const textRatio = files.length > 0 ? Math.round(textFiles / files.length * 1000) / 1000 : 0;

    const data = { extensionDistribution: extDist, topExtensions, textFileRatio: textRatio,
      uniqueExtensions: Object.keys(extDist).length };
    const fingerprint = sha256(topExtensions.map(e => `${e.ext}:${e.count}`).join(','));

    return { layer: 4, name: 'semantic', implementation: 'extension_distribution_profile',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L5: Metadata ─────────────────────────────────────────────────────────

  private async layer5(zip: JSZip, entries: JSZip.JSZipObject[]): Promise<UniversalLayerResult> {
    const t = Date.now();

    // Date range of entries (guard against NaN/Invalid Date)
    const rawDates = entries.map(e => e.date?.getTime() ?? 0).filter(n => n > 0 && isFinite(n));
    const safeDate = (n: number) => { try { return new Date(n).toISOString(); } catch { return null; } };
    const oldest = rawDates.length ? safeDate(Math.min(...rawDates)) : null;
    const newest = rawDates.length ? safeDate(Math.max(...rawDates)) : null;

    // Compression methods — convert magic bytes to hex to avoid null-byte issues in PostgreSQL JSONB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawMagic = entries.map(e => (e as any)._data?.compression?.magic ?? null);
    const methods = new Set(rawMagic.map(m =>
      typeof m === 'string' ? Buffer.from(m, 'binary').toString('hex') : 'unknown'
    ));
    const zipComment = (zip as unknown as { comment?: string }).comment ?? null;

    const data = {
      compressionMethods: [...methods],
      zipComment,
      hasComment: !!zipComment,
      oldestEntry: oldest,
      newestEntry: newest,
      fileCount: entries.filter(e => !e.dir).length,
    };

    const fingerprint = sha256(JSON.stringify({ methods: [...methods], zipComment }));
    return { layer: 5, name: 'metadata', implementation: 'compression_method_meta',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L6: Signature ───────────────────────────────────────────────────────

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const hmac = computeHmac(`ZIP:${dnaRecordId}:${fingerprints}`, config.stego.signatureSecret);
    return { layer: 6, name: 'signature', implementation: 'hmac_sha256',
      fingerprint: hmac, data: { hmac, dnaRecordId, embedded: false },
      success: true, processingMs: Date.now() - t };
  }

  private async runLayer(fn: () => UniversalLayerResult | Promise<UniversalLayerResult>): Promise<UniversalLayerResult> {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('ZIP layer failed', { error });
      return { layer: 1, name: 'cryptographic', implementation: 'error',
        fingerprint: '', data: {}, success: false, processingMs: 0, error };
    }
  }
}
