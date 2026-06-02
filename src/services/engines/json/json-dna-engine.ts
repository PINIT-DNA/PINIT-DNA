/**
 * PINIT-DNA — JSON DNA Engine
 *
 * Generates all 6 DNA fingerprint layers for JSON files.
 *
 * L1 — Cryptographic : SHA-256 of raw bytes
 * L2 — Structural    : Key tree hash + depth + breadth
 * L3 — Perceptual    : SimHash of sorted key-value pairs
 * L4 — Semantic      : Value type distribution (string/number/boolean/null/object/array)
 * L5 — Metadata      : Encoding, top-level type, key count, depth, schema hints
 * L6 — Signature     : HMAC-SHA256 over all L1–L5 fingerprints
 */

import crypto from 'crypto';
import { config } from '../../../config';
import { logger } from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';
import { FileInput } from '../../universal-file-router';
import { UniversalEngineResult, UniversalLayerResult } from '../../../types/universal-engine.types';
import {
  simHash64,
  detectEncoding,
  computeHmac,
  sha256,
} from '../base/text-utils';

// ─── JSON traversal helpers ───────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray  = JsonValue[];

type ValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

interface TreeStats {
  keyCount: number;
  depth: number;
  breadth: number;
  keyPaths: string[];
  typeDistribution: Record<ValueType, number>;
}

function traverse(value: JsonValue, path: string, stats: TreeStats, depth: number): void {
  stats.depth = Math.max(stats.depth, depth);

  if (value === null) {
    stats.typeDistribution.null++;
  } else if (Array.isArray(value)) {
    stats.typeDistribution.array++;
    stats.breadth = Math.max(stats.breadth, value.length);
    value.forEach((item, i) => traverse(item, `${path}[${i}]`, stats, depth + 1));
  } else if (typeof value === 'object') {
    stats.typeDistribution.object++;
    const keys = Object.keys(value as JsonObject);
    stats.breadth = Math.max(stats.breadth, keys.length);
    for (const key of keys) {
      stats.keyCount++;
      const keyPath = path ? `${path}.${key}` : key;
      stats.keyPaths.push(keyPath);
      traverse((value as JsonObject)[key], keyPath, stats, depth + 1);
    }
  } else if (typeof value === 'string') {
    stats.typeDistribution.string++;
  } else if (typeof value === 'number') {
    stats.typeDistribution.number++;
  } else if (typeof value === 'boolean') {
    stats.typeDistribution.boolean++;
  }
}

function buildTreeStats(root: JsonValue): TreeStats {
  const stats: TreeStats = {
    keyCount: 0, depth: 0, breadth: 0, keyPaths: [],
    typeDistribution: { string: 0, number: 0, boolean: 0, null: 0, object: 0, array: 0 },
  };
  traverse(root, '', stats, 0);
  return stats;
}

/**
 * Sorted flat key-value string — used for SimHash perceptual fingerprint.
 * Sorting ensures order-independent similarity matching.
 */
function flattenSorted(value: JsonValue, maxDepth = 4, depth = 0): string[] {
  if (depth > maxDepth) return [];
  if (value === null || typeof value !== 'object') return [String(value)];

  if (Array.isArray(value)) {
    return value.flatMap(v => flattenSorted(v, maxDepth, depth + 1));
  }

  return Object.entries(value as JsonObject)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([k, v]) => [`${k}:${flattenSorted(v, maxDepth, depth + 1).join(',')}`]);
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class JsonDnaEngine {
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const layers: UniversalLayerResult[] = [];

    logger.info('JSON DNA engine started', { dnaRecordId, file: file.originalName });

    // Parse JSON once — share across all layers
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(file.buffer.toString('utf-8')) as JsonValue;
    } catch (err) {
      // Invalid JSON — fail all layers except L1
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('JSON parse failed', { dnaRecordId, error: errMsg });
      layers.push(await this.runLayer(() => this.layer1(file.buffer)));
      for (let i = 2; i <= 6; i++) {
        layers.push({ layer: i as UniversalLayerResult['layer'], name: 'structural',
          implementation: 'parse_failed', fingerprint: '', data: { error: errMsg },
          success: false, processingMs: 0, error: `JSON parse failed: ${errMsg}` });
      }
      const status = 'PARTIAL';
      await prisma.dnaRecord.update({ where: { id: dnaRecordId },
        data: { status, universalFingerprints: { layers } as object } });
      return { dnaRecordId, fileType: 'JSON', engineVersion: config.dna.engineVersion,
        schemaVersion: config.dna.schemaVersion, layers, status,
        totalProcessingMs: Date.now() - start, generatedAt: new Date() };
    }

    const stats = buildTreeStats(parsed);

    layers.push(await this.runLayer(() => this.layer1(file.buffer)));
    layers.push(await this.runLayer(() => this.layer2(parsed, stats)));
    layers.push(await this.runLayer(() => this.layer3(parsed)));
    layers.push(await this.runLayer(() => this.layer4(stats)));
    layers.push(await this.runLayer(() => this.layer5(file.buffer, parsed, stats)));

    const fingerprints = layers.filter(l => l.success).map(l => l.fingerprint).join('|');
    layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));

    const successful = layers.filter(l => l.success).length;
    const status = successful === 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status, universalFingerprints: { layers } as object },
    });

    logger.info('JSON DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return { dnaRecordId, fileType: 'JSON', engineVersion: config.dna.engineVersion,
      schemaVersion: config.dna.schemaVersion, layers, status,
      totalProcessingMs: totalMs, generatedAt: new Date() };
  }

  // ─── L1: Cryptographic ───────────────────────────────────────────────────

  private layer1(buffer: Buffer): UniversalLayerResult {
    const t = Date.now();
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return { layer: 1, name: 'cryptographic', implementation: 'sha256',
      fingerprint: sha256Hash, data: { sha256Hash },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L2: Structural ──────────────────────────────────────────────────────

  private layer2(parsed: JsonValue, stats: TreeStats): UniversalLayerResult {
    const t = Date.now();
    const topLevelType = Array.isArray(parsed) ? 'array'
      : parsed === null ? 'null'
      : typeof parsed === 'object' ? 'object'
      : typeof parsed;

    // Sorted key paths → structural fingerprint
    const sortedPaths  = [...stats.keyPaths].sort();
    const fingerprint  = sha256(sortedPaths.join('|'));
    const data = { topLevelType, keyCount: stats.keyCount, depth: stats.depth,
      breadth: stats.breadth, sortedKeyCount: sortedPaths.length,
      keyTreeHash: fingerprint };

    return { layer: 2, name: 'structural', implementation: 'key_tree_depth_breadth_hash',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L3: Perceptual ──────────────────────────────────────────────────────

  private layer3(parsed: JsonValue): UniversalLayerResult {
    const t = Date.now();
    const flat       = flattenSorted(parsed).join(' ');
    const hash64     = simHash64(flat);
    const canonical  = sha256(flat.slice(0, 8192)); // first 8KB canonical hash

    return { layer: 3, name: 'perceptual', implementation: 'sorted_keyvalue_simhash',
      fingerprint: hash64, data: { simHash64: hash64, canonicalHash: canonical },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L4: Semantic ────────────────────────────────────────────────────────

  private layer4(stats: TreeStats): UniversalLayerResult {
    const t = Date.now();
    const total = Object.values(stats.typeDistribution).reduce((a, b) => a + b, 0);
    const dist  = total > 0
      ? Object.fromEntries(Object.entries(stats.typeDistribution)
          .map(([k, v]) => [k, Math.round(v / total * 1000) / 1000]))
      : stats.typeDistribution;

    const fingerprint = sha256(JSON.stringify(dist));
    return { layer: 4, name: 'semantic', implementation: 'value_type_distribution',
      fingerprint, data: { typeDistribution: dist, rawCounts: stats.typeDistribution, total },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L5: Metadata ────────────────────────────────────────────────────────

  private layer5(buffer: Buffer, parsed: JsonValue, stats: TreeStats): UniversalLayerResult {
    const t = Date.now();
    const { encoding, hasBom } = detectEncoding(buffer);
    const topLevelType = Array.isArray(parsed) ? 'array'
      : parsed === null ? 'null'
      : typeof parsed === 'object' ? 'object'
      : typeof parsed;

    // Schema version hint: look for common version fields
    let schemaVersionHint: string | null = null;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as JsonObject;
      for (const key of ['$schema', 'version', 'schemaVersion', 'schema_version', 'apiVersion']) {
        if (typeof obj[key] === 'string') {
          schemaVersionHint = obj[key] as string;
          break;
        }
      }
    }

    const data = { encoding, hasBom, topLevelType, keyCount: stats.keyCount,
      depth: stats.depth, schemaVersionHint, fileSize: buffer.length };
    const fingerprint = sha256(JSON.stringify({ encoding, topLevelType, depth: stats.depth }));

    return { layer: 5, name: 'metadata', implementation: 'encoding_schema_hint_meta',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L6: Signature ───────────────────────────────────────────────────────

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const hmac = computeHmac(`JSON:${dnaRecordId}:${fingerprints}`, config.stego.signatureSecret);
    return { layer: 6, name: 'signature', implementation: 'hmac_sha256',
      fingerprint: hmac, data: { hmac, dnaRecordId, embedded: false },
      success: true, processingMs: Date.now() - t };
  }

  private async runLayer(fn: () => UniversalLayerResult): Promise<UniversalLayerResult> {
    try {
      return fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('JSON layer failed', { error });
      return { layer: 1, name: 'cryptographic', implementation: 'error',
        fingerprint: '', data: {}, success: false, processingMs: 0, error };
    }
  }
}
