/**
 * PINIT-DNA — Metadata Diff Service
 *
 * Extracts and compares metadata from both files.
 * Detects: author changes, timestamp changes, device changes, GPS changes.
 */

import exifr  from 'exifr';
import JSZip  from 'jszip';
import type { MetadataDiffResult, MetadataFieldChange } from '../../types/forensic-diff.types';

type Significance = 'low' | 'medium' | 'high';

// Field significance map
const FIELD_SIGNIFICANCE: Record<string, Significance> = {
  Author: 'high', Creator: 'high', LastModifiedBy: 'high', Producer: 'high',
  CreationDate: 'high', ModDate: 'high', created: 'high', modified: 'high',
  Make: 'medium', Model: 'medium', Software: 'medium',
  GPSLatitude: 'high', GPSLongitude: 'high',
  revision: 'medium', company: 'medium',
  XResolution: 'low', YResolution: 'low', ColorSpace: 'low',
};

const FIELD_CATEGORY = (field: string): MetadataFieldChange['category'] => {
  if (['Author','Creator','LastModifiedBy','Producer','company'].includes(field)) return 'authorship';
  if (['CreationDate','ModDate','created','modified','DateTime'].includes(field)) return 'timestamp';
  if (['Make','Model','Software','DeviceManufacturer'].includes(field)) return 'device';
  if (['GPSLatitude','GPSLongitude','GPSAltitude'].includes(field)) return 'location';
  if (['XResolution','YResolution','ColorSpace','BitsPerSample'].includes(field)) return 'technical';
  return 'custom';
};

const FIELD_NOTE = (field: string, before: string | null, after: string | null): string => {
  if (['Author','Creator'].includes(field)) return `File authorship changed from "${before}" to "${after}" — may indicate ownership transfer or forgery`;
  if (['LastModifiedBy'].includes(field))   return `Last editor changed — file was modified by a different user`;
  if (['CreationDate','created'].includes(field)) return `Creation date changed — file creation metadata was altered`;
  if (['ModDate','modified'].includes(field)) return `Modification date changed — indicates file was re-saved`;
  if (['Make','Model'].includes(field))      return `Device information changed — file may have been processed by different software`;
  if (['GPSLatitude','GPSLongitude'].includes(field)) return `Location data changed — GPS coordinates were modified`;
  if (['Software'].includes(field))          return `Processing software changed from "${before}" to "${after}"`;
  return `Metadata field "${field}" was changed`;
};

// ─── Metadata extractors ──────────────────────────────────────────────────────

async function extractImageMeta(buffer: Buffer): Promise<Record<string, string | null>> {
  try {
    const data = await exifr.parse(buffer, {
      pick: ['Make','Model','Software','DateTime','DateTimeOriginal',
             'GPSLatitude','GPSLongitude','XResolution','YResolution','ColorSpace'],
    });
    if (!data) return {};
    const result: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(data)) {
      result[k] = v != null ? String(v) : null;
    }
    return result;
  } catch { return {}; }
}

function extractXmlValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:dc:|cp:|vt:)?${tag}[^>]*>([^<]*)<\\/`, 'i');
  const m  = re.exec(xml);
  return m ? m[1].trim() || null : null;
}

async function extractOpcMeta(buffer: Buffer): Promise<Record<string, string | null>> {
  try {
    const zip  = await JSZip.loadAsync(buffer);
    const core = zip.file('docProps/core.xml');
    const app  = zip.file('docProps/app.xml');
    if (!core) return {};

    const coreXml = await core.async('text');
    const appXml  = app ? await app.async('text') : '';

    return {
      Author:         extractXmlValue(coreXml, 'creator'),
      LastModifiedBy: extractXmlValue(coreXml, 'lastModifiedBy'),
      created:        extractXmlValue(coreXml, 'created'),
      modified:       extractXmlValue(coreXml, 'modified'),
      revision:       extractXmlValue(coreXml, 'revision'),
      company:        extractXmlValue(appXml,  'Company'),
      Software:       extractXmlValue(appXml,  'Application'),
    };
  } catch { return {}; }
}

async function extractPdfMeta(buffer: Buffer): Promise<Record<string, string | null>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (b: Buffer) => Promise<{ info: Record<string, unknown> }> = require('pdf-parse');
    const data = await pdfParse(buffer);
    const info = data.info ?? {};
    return {
      Author:       info['Author']       ? String(info['Author'])       : null,
      Creator:      info['Creator']      ? String(info['Creator'])      : null,
      Producer:     info['Producer']     ? String(info['Producer'])     : null,
      CreationDate: info['CreationDate'] ? String(info['CreationDate']) : null,
      ModDate:      info['ModDate']      ? String(info['ModDate'])      : null,
    };
  } catch { return {}; }
}

async function extractMeta(buffer: Buffer, mimeType: string): Promise<Record<string, string | null>> {
  if (mimeType.startsWith('image/'))         return extractImageMeta(buffer);
  if (mimeType === 'application/pdf')         return extractPdfMeta(buffer);
  if (mimeType.includes('wordprocessingml') ||
      mimeType.includes('presentationml'))    return extractOpcMeta(buffer);
  // Also try OPC by magic bytes
  if (buffer.slice(0, 2).toString('hex') === '504b') return extractOpcMeta(buffer);
  return {};
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class MetadataDiffService {
  async diff(
    bufferA: Buffer,
    bufferB: Buffer,
    mimeType: string
  ): Promise<MetadataDiffResult> {
    const [metaA, metaB] = await Promise.all([
      extractMeta(bufferA, mimeType),
      extractMeta(bufferB, mimeType),
    ]);

    const changes: MetadataFieldChange[] = [];
    const allFields = new Set([...Object.keys(metaA), ...Object.keys(metaB)]);

    for (const field of allFields) {
      const before = metaA[field] ?? null;
      const after  = metaB[field] ?? null;

      if (before === after) continue;

      let changeType: MetadataFieldChange['changeType'];
      if (before === null) changeType = 'added';
      else if (after === null) changeType = 'removed';
      else changeType = 'modified';

      changes.push({
        field,
        category:     FIELD_CATEGORY(field),
        before,
        after,
        changeType,
        significance: FIELD_SIGNIFICANCE[field] ?? 'low',
        forensicNote: FIELD_NOTE(field, before, after),
      });
    }

    // Sort: high significance first
    changes.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.significance] - order[b.significance];
    });

    const authorshipChanged = changes.some(c => c.category === 'authorship');
    const timestampChanged  = changes.some(c => c.category === 'timestamp');
    const deviceChanged     = changes.some(c => c.category === 'device');
    const locationChanged   = changes.some(c => c.category === 'location');

    let summary = '';
    if (changes.length === 0) {
      summary = 'No metadata differences detected';
    } else {
      const parts: string[] = [];
      if (authorshipChanged) parts.push('authorship');
      if (timestampChanged)  parts.push('timestamps');
      if (deviceChanged)     parts.push('device info');
      if (locationChanged)   parts.push('GPS location');
      const other = changes.filter(c => !['authorship','timestamp','device','location'].includes(c.category)).length;
      if (other > 0) parts.push(`${other} other fields`);
      summary = `${changes.length} metadata changes detected: ${parts.join(', ')}`;
    }

    return {
      totalChanges:      changes.length,
      authorshipChanged,
      timestampChanged,
      deviceChanged,
      locationChanged,
      changes,
      summary,
    };
  }
}
