/**
 * PINIT-DNA — Layer 5: Metadata Provenance Record
 *
 * From the theoretical spec:
 *   "Following the emerging industry standard called C2PA (Coalition for Content
 *    Provenance and Authenticity), the system creates a structured record containing:
 *    the creation timestamp, the owner session identifier, the tool name and version,
 *    and a cryptographic link to the Layer 1 hash. This record is embedded in the
 *    image file's metadata fields and travels with the image whenever it is shared."
 *
 * What this layer does:
 *
 *   GENERATE:
 *     1. Extract all existing EXIF/IPTC/XMP metadata from the image (via exifr)
 *     2. Build a C2PA-style provenance manifest (our own structured record)
 *     3. Compute SHA-256 of the full metadata block for tamper detection
 *     4. Return device fingerprint, GPS, capture time, and provenance record
 *
 *   VERIFY (spec §5.3 step 16):
 *     "System reads metadata fields. Is a valid C2PA provenance record present?"
 *     - metadataHash exact match → score 1.0
 *     - Partial field matches → proportional score
 *     - No provenance record found → score 0.0
 *
 * Survives:  Normal file sharing, email, messaging apps that preserve metadata.
 * Defeated by: Any image editor or social media platform that strips EXIF.
 *
 * Note: This is the most easily stripped layer — its value is providing
 * human-readable provenance evidence for legitimate use cases and legal proceedings.
 */

import crypto from 'crypto';
import sharp from 'sharp';
import { ImageInput, MetadataLayerResult } from '../../types/dna.types';
import { logger } from '../../lib/logger';
import { config } from '../../config';

// C2PA-style provenance manifest structure embedded by this system
interface ProvenanceManifest {
  tool: string;
  version: string;
  dnaRecordId: string | null;
  generatedAt: string;
  schemaVersion: string;
  // Cryptographic link to Layer 1 (populated by orchestrator if available)
  layer1HashRef: string | null;
}

export class MetadataLayer {
  readonly layerNumber = 5 as const;
  readonly layerName = 'metadata' as const;

  /**
   * Extract metadata provenance from the image and build a C2PA-style record.
   *
   * @param image       - The uploaded image
   * @param dnaRecordId - DNA record ID to embed in the provenance manifest
   * @param layer1Hash  - SHA-256 hash from Layer 1 (cryptographic link per spec)
   */
  async generate(
    image: ImageInput,
    dnaRecordId?: string,
    layer1Hash?: string
  ): Promise<MetadataLayerResult> {
    const start = Date.now();
    logger.debug('Layer 5 — extracting metadata provenance', {
      file: image.originalName,
    });

    try {
      // ── Step 1: Extract existing EXIF/IPTC/XMP via exifr ─────────────────
      const exifData = await this.parseExif(image.buffer);

      // ── Step 2: Pull device fingerprint fields ─────────────────────────────
      const deviceMake   = this.getString(exifData, ['Make', 'make']) ?? null;
      const deviceModel  = this.getString(exifData, ['Model', 'model']) ?? null;
      const software     = this.getString(exifData, ['Software', 'software']) ?? null;

      // ── Step 3: Pull capture datetime ─────────────────────────────────────
      const capturedAt = this.parseDatetime(exifData);

      // ── Step 4: Pull GPS coordinates ──────────────────────────────────────
      const gpsLatitude  = this.getNumber(exifData, ['latitude', 'GPSLatitude']) ?? null;
      const gpsLongitude = this.getNumber(exifData, ['longitude', 'GPSLongitude']) ?? null;

      // ── Step 5: Extract IPTC and XMP blocks ───────────────────────────────
      const iptcData = this.extractBlock(exifData, 'iptc');
      const xmpData  = this.extractBlock(exifData, 'xmp');

      // ── Step 6: Build C2PA-style provenance manifest ──────────────────────
      // Per spec: "creation timestamp, session identifier, tool name and version,
      //            and a cryptographic link to the Layer 1 hash"
      const provenance: ProvenanceManifest = {
        tool: 'PINIT-DNA',
        version: config.dna.schemaVersion,
        dnaRecordId: dnaRecordId ?? null,
        generatedAt: new Date().toISOString(),
        schemaVersion: config.dna.schemaVersion,
        layer1HashRef: layer1Hash ?? null,
      };

      // ── Step 7: Compute metadata hash ─────────────────────────────────────
      // SHA-256 of the stable fields only — excludes generatedAt (timestamp)
      // so the hash is deterministic for the same image + dnaRecordId + layer1Hash.
      const stablePayload = {
        exif: exifData ? this.sortKeys(exifData as Record<string, unknown>) : null,
        dnaRecordId: provenance.dnaRecordId,
        layer1HashRef: provenance.layer1HashRef,
        tool: provenance.tool,
        version: provenance.version,
      };

      const metadataHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(stablePayload))
        .digest('hex');

      // ── Step 8: Get image dimensions via sharp ─────────────────────────────
      const sharpMeta = await sharp(image.buffer).metadata();

      const result: MetadataLayerResult = {
        layer: 5,
        name: this.layerName,
        success: true,
        processingMs: Date.now() - start,
        data: {
          exifData: exifData as Record<string, unknown> | null,
          deviceMake,
          deviceModel,
          software,
          capturedAt,
          gpsLatitude,
          gpsLongitude,
          iptcData,
          xmpData,
          metadataHash,
        },
      };

      logger.debug('Layer 5 — complete', {
        hasExif: !!exifData,
        deviceMake,
        deviceModel,
        hasCaptureTime: !!capturedAt,
        hasGps: !!gpsLatitude,
        imageWidth: sharpMeta.width,
        imageHeight: sharpMeta.height,
        metadataHash: metadataHash.substring(0, 16) + '...',
        processingMs: result.processingMs,
      });

      return result;
    } catch (err) {
      logger.error('Layer 5 — failed', { error: err });
      return {
        layer: 5,
        name: this.layerName,
        success: false,
        processingMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
        data: {
          exifData: null,
          deviceMake: null,
          deviceModel: null,
          software: null,
          capturedAt: null,
          gpsLatitude: null,
          gpsLongitude: null,
          iptcData: null,
          xmpData: null,
          metadataHash: '',
        },
      };
    }
  }

  /**
   * Verify metadata provenance against stored record.
   *
   * Scoring:
   *   metadataHash exact match       → 1.0 (full provenance intact)
   *   deviceMake + deviceModel match  → 0.5
   *   capturedAt within 1s           → 0.3
   *   Any single field match          → 0.1
   *   No match                        → 0.0
   */
  verify(
    probe: MetadataLayerResult['data'],
    stored: {
      deviceMake: string | null;
      deviceModel: string | null;
      capturedAt: Date | null;
      metadataHash: string;
    }
  ): number {
    if (!probe.metadataHash || !stored.metadataHash) return 0;

    // Exact hash match — full provenance record intact
    if (probe.metadataHash === stored.metadataHash) {
      logger.debug('Layer 5 — verify PASSED (metadataHash match)');
      return 1.0;
    }

    // Partial field matching
    let score = 0;

    const makeMatch  = probe.deviceMake  && stored.deviceMake  &&
                       probe.deviceMake.toLowerCase() === stored.deviceMake.toLowerCase();
    const modelMatch = probe.deviceModel && stored.deviceModel &&
                       probe.deviceModel.toLowerCase() === stored.deviceModel.toLowerCase();

    if (makeMatch && modelMatch) score += 0.5;
    else if (makeMatch || modelMatch) score += 0.2;

    if (probe.capturedAt && stored.capturedAt) {
      const diffMs = Math.abs(
        new Date(probe.capturedAt).getTime() - new Date(stored.capturedAt).getTime()
      );
      if (diffMs <= 1000) score += 0.3;
      else if (diffMs <= 60000) score += 0.1;
    }

    logger.debug('Layer 5 — verify PARTIAL', {
      score,
      makeMatch,
      modelMatch,
    });

    return Math.min(score, 1.0);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Parse EXIF/IPTC/XMP from image buffer using exifr */
  private async parseExif(buffer: Buffer): Promise<Record<string, unknown> | null> {
    try {
      // Dynamic import — exifr is ESM-only in newer versions
      const exifr = await import('exifr');
      const data = await exifr.default.parse(buffer, {
        tiff: true,
        xmp: true,
        iptc: true,
        gps: true,
        translateKeys: true,
        translateValues: true,
      });
      return data ?? null;
    } catch {
      // Image has no EXIF — not an error, just absence of metadata
      return null;
    }
  }

  /** Safely extract a string value from nested keys */
  private getString(
    data: Record<string, unknown> | null,
    keys: string[]
  ): string | undefined {
    if (!data) return undefined;
    for (const key of keys) {
      const val = data[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return undefined;
  }

  /** Safely extract a numeric value from nested keys */
  private getNumber(
    data: Record<string, unknown> | null,
    keys: string[]
  ): number | undefined {
    if (!data) return undefined;
    for (const key of keys) {
      const val = data[key];
      if (typeof val === 'number' && isFinite(val)) return val;
    }
    return undefined;
  }

  /** Extract and parse capture datetime from EXIF */
  private parseDatetime(data: Record<string, unknown> | null): Date | null {
    if (!data) return null;
    const keys = ['DateTimeOriginal', 'DateTime', 'CreateDate', 'dateTimeOriginal'];
    for (const key of keys) {
      const val = data[key];
      if (val instanceof Date) return val;
      if (typeof val === 'string') {
        const parsed = new Date(val);
        if (!isNaN(parsed.getTime())) return parsed;
      }
    }
    return null;
  }

  /** Extract a named block (iptc/xmp) as a plain object or null */
  private extractBlock(
    data: Record<string, unknown> | null,
    key: string
  ): Record<string, unknown> | null {
    if (!data) return null;
    const block = data[key];
    if (block && typeof block === 'object' && !Array.isArray(block)) {
      return block as Record<string, unknown>;
    }
    return null;
  }

  /** Sort object keys for deterministic JSON serialisation */
  private sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = obj[key];
        return acc;
      }, {});
  }
}
