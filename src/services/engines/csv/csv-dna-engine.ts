/**
 * PINIT-DNA — CSV DNA Engine
 *
 * Generates all 6 DNA fingerprint layers for CSV files.
 *
 * L1 — Cryptographic : SHA-256 of raw bytes
 * L2 — Structural    : Row/column count + column type signature
 * L3 — Perceptual    : SimHash of normalised data values
 * L4 — Semantic      : Column type ratios, null%, unique% per column
 * L5 — Metadata      : Delimiter, encoding, BOM, header detection
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

// ─── Simple CSV Parser ────────────────────────────────────────────────────────

interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
  hasHeader: boolean;
  quoteChar: string;
}

function detectDelimiter(sample: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = (sample.match(new RegExp('\\' + (d === '\t' ? 't' : d), 'g')) ?? []).length;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

function parseCsv(content: string): ParsedCsv {
  const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
  const sample = lines.slice(0, 10).join('\n');
  const delimiter = detectDelimiter(sample);
  const quoteChar = '"';

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let inQuote = false;
    let current = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === quoteChar) {
        inQuote = !inQuote;
      } else if (ch === delimiter && !inQuote) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const allRows = lines.map(parseRow);
  if (allRows.length === 0) return { headers: [], rows: [], delimiter, hasHeader: false, quoteChar };

  // Heuristic: first row is a header if all cells are non-numeric strings
  const firstRow = allRows[0];
  const hasHeader = firstRow.every(cell => isNaN(Number(cell)) && cell.length > 0 && cell.length < 100);
  const headers = hasHeader ? firstRow : firstRow.map((_, i) => `col_${i}`);
  const rows = hasHeader ? allRows.slice(1) : allRows;

  return { headers, rows, delimiter, hasHeader, quoteChar };
}

// ─── Column type detection ────────────────────────────────────────────────────

type ColType = 'number' | 'boolean' | 'date' | 'string' | 'empty';

function detectColType(values: string[]): ColType {
  const nonEmpty = values.filter(v => v !== '');
  if (nonEmpty.length === 0) return 'empty';
  let numCount = 0, boolCount = 0, dateCount = 0;
  for (const v of nonEmpty) {
    if (!isNaN(Number(v))) numCount++;
    else if (['true', 'false', 'yes', 'no', '1', '0'].includes(v.toLowerCase())) boolCount++;
    else if (!isNaN(Date.parse(v))) dateCount++;
  }
  const n = nonEmpty.length;
  if (numCount / n > 0.8)  return 'number';
  if (boolCount / n > 0.8) return 'boolean';
  if (dateCount / n > 0.8) return 'date';
  return 'string';
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class CsvDnaEngine {
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const content = file.buffer.toString('utf-8');
    const parsed  = parseCsv(content);
    const layers: UniversalLayerResult[] = [];

    logger.info('CSV DNA engine started', { dnaRecordId, file: file.originalName });

    layers.push(await this.runLayer(() => this.layer1(file.buffer)));
    layers.push(await this.runLayer(() => this.layer2(parsed)));
    layers.push(await this.runLayer(() => this.layer3(parsed)));
    layers.push(await this.runLayer(() => this.layer4(parsed)));
    layers.push(await this.runLayer(() => this.layer5(file.buffer, parsed)));

    const fingerprints = layers.filter(l => l.success).map(l => l.fingerprint).join('|');
    layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));

    const successful = layers.filter(l => l.success).length;
    const status = successful >= 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status, universalFingerprints: { layers } as object },
    });

    logger.info('CSV DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return {
      dnaRecordId, fileType: 'CSV', engineVersion: config.dna.engineVersion,
      schemaVersion: config.dna.schemaVersion,
      layers, status, totalProcessingMs: totalMs, generatedAt: new Date(),
    };
  }

  // ─── L1: Cryptographic ───────────────────────────────────────────────────

  private layer1(buffer: Buffer): UniversalLayerResult {
    const t = Date.now();
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return {
      layer: 1, name: 'cryptographic', implementation: 'sha256',
      fingerprint: sha256Hash, data: { sha256Hash },
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L2: Structural ──────────────────────────────────────────────────────

  private layer2(parsed: ParsedCsv): UniversalLayerResult {
    const t = Date.now();
    const colTypes = parsed.headers.map((_, i) =>
      detectColType(parsed.rows.map(r => r[i] ?? ''))
    );
    const typeSignature = colTypes.join('-');
    const data = {
      rowCount: parsed.rows.length,
      columnCount: parsed.headers.length,
      hasHeader: parsed.hasHeader,
      columnNames: parsed.headers,
      columnTypes: colTypes,
      typeSignature,
    };
    const fingerprint = sha256(`${parsed.rows.length}:${parsed.headers.length}:${typeSignature}`);
    return {
      layer: 2, name: 'structural', implementation: 'row_col_schema_fingerprint',
      fingerprint, data, success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L3: Perceptual ──────────────────────────────────────────────────────

  private layer3(parsed: ParsedCsv): UniversalLayerResult {
    const t = Date.now();
    // Sample first 200 rows normalised: lowercase, trim
    const sample = parsed.rows.slice(0, 200)
      .map(row => row.map(cell => cell.toLowerCase().trim()).join(','))
      .join('\n');
    const hash64     = simHash64(sample);
    // Per-column value hash (hash of all values in each column)
    const colHashes  = parsed.headers.map((_, i) => {
      const vals = parsed.rows.map(r => (r[i] ?? '').toLowerCase().trim()).join('|');
      return sha256(vals);
    });
    const dataHash   = sha256(sample);

    return {
      layer: 3, name: 'perceptual', implementation: 'data_value_simhash',
      fingerprint: hash64,
      data: { simHash64: hash64, dataSampleHash: dataHash, columnValueHashes: colHashes },
      success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L4: Semantic ────────────────────────────────────────────────────────

  private layer4(parsed: ParsedCsv): UniversalLayerResult {
    const t = Date.now();
    const colCount = parsed.headers.length;
    const colTypes = parsed.headers.map((_, i) =>
      detectColType(parsed.rows.map(r => r[i] ?? ''))
    );

    const numericCols  = colTypes.filter(t => t === 'number').length;
    const numericRatio = colCount > 0 ? numericCols / colCount : 0;

    // Null ratio per column
    const nullRatio: Record<string, number> = {};
    const uniqueRatio: Record<string, number> = {};
    for (let i = 0; i < parsed.headers.length; i++) {
      const vals   = parsed.rows.map(r => r[i] ?? '');
      const nulls  = vals.filter(v => v === '' || v.toLowerCase() === 'null').length;
      const unique = new Set(vals).size;
      nullRatio[parsed.headers[i]]   = vals.length ? Math.round(nulls / vals.length * 1000) / 1000 : 0;
      uniqueRatio[parsed.headers[i]] = vals.length ? Math.round(unique / vals.length * 1000) / 1000 : 0;
    }

    const data = { numericColumnRatio: Math.round(numericRatio * 1000) / 1000,
      columnTypes: colTypes, nullRatioPerColumn: nullRatio, uniqueRatioPerColumn: uniqueRatio };

    const fingerprint = sha256(JSON.stringify({ numericRatio, colTypes }));
    return {
      layer: 4, name: 'semantic', implementation: 'column_type_distribution',
      fingerprint, data, success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L5: Metadata ────────────────────────────────────────────────────────

  private layer5(buffer: Buffer, parsed: ParsedCsv): UniversalLayerResult {
    const t = Date.now();
    const { encoding, hasBom } = detectEncoding(buffer);
    const data = {
      delimiter: parsed.delimiter === '\t' ? 'TAB' : parsed.delimiter,
      encoding, hasBom, hasHeader: parsed.hasHeader,
      quoteChar: parsed.quoteChar, fileSize: buffer.length,
      rowCount: parsed.rows.length, columnCount: parsed.headers.length,
    };
    const fingerprint = sha256(JSON.stringify({ delimiter: data.delimiter, encoding, hasBom }));
    return {
      layer: 5, name: 'metadata', implementation: 'delimiter_encoding_meta',
      fingerprint, data, success: true, processingMs: Date.now() - t,
    };
  }

  // ─── L6: Signature ───────────────────────────────────────────────────────

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const hmac = computeHmac(`CSV:${dnaRecordId}:${fingerprints}`, config.stego.signatureSecret);
    return {
      layer: 6, name: 'signature', implementation: 'hmac_sha256',
      fingerprint: hmac,
      data: { hmac, dnaRecordId, embedded: false },
      success: true, processingMs: Date.now() - t,
    };
  }

  private async runLayer(fn: () => UniversalLayerResult): Promise<UniversalLayerResult> {
    try {
      return fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('CSV layer failed', { error });
      return { layer: 1, name: 'cryptographic', implementation: 'error',
        fingerprint: '', data: {}, success: false, processingMs: 0, error };
    }
  }
}
