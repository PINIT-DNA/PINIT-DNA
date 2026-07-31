/**
 * PINIT-DNA — Layer 5: Metadata Provenance Record
 *
 * Milestone B Step 1: when DNA_DETERMINISTIC_MODE is ON, metadataHash equals
 * EDS claims_digest (content/claims only — no dnaRecordId / generatedAt).
 * Legacy mode retains dnaRecordId in the hash for rollback.
 */

import crypto from 'crypto';
import sharp from 'sharp';
import { ImageInput, MetadataLayerResult } from '../../types/dna.types';
import { logger } from '../../lib/logger';
import { config } from '../../config';
import {
  CLAIMS_DIGEST_ALGORITHM_ID,
  computeClaimsDigest,
  isDnaDeterministicModeEnabled,
} from '../dna/deterministic-identity';
import {
  logIdentityLayerCompleted,
  logIdentityLayerStarted,
} from '../dna/identity-generation-logger';

interface ProvenanceManifest {
  tool: string;
  version: string;
  dnaRecordId: string | null;
  generatedAt: string;
  schemaVersion: string;
  layer1HashRef: string | null;
}

export class MetadataLayer {
  readonly layerNumber = 5 as const;
  readonly layerName = 'metadata' as const;

  async generate(
    image: ImageInput,
    dnaRecordId?: string,
    layer1Hash?: string
  ): Promise<MetadataLayerResult> {
    const start = Date.now();
    const deterministic = isDnaDeterministicModeEnabled();
    logIdentityLayerStarted(5, this.layerName, { file: image.originalName, deterministic });

    try {
      const exifData = await this.parseExif(image.buffer);

      const deviceMake   = this.getString(exifData, ['Make', 'make']) ?? null;
      const deviceModel  = this.getString(exifData, ['Model', 'model']) ?? null;
      const software     = this.getString(exifData, ['Software', 'software']) ?? null;
      const capturedAt = this.parseDatetime(exifData);
      const gpsLatitude  = this.getNumber(exifData, ['latitude', 'GPSLatitude']) ?? null;
      const gpsLongitude = this.getNumber(exifData, ['longitude', 'GPSLongitude']) ?? null;
      const iptcData = this.extractBlock(exifData, 'iptc');
      const xmpData  = this.extractBlock(exifData, 'xmp');

      const provenance: ProvenanceManifest = {
        tool: 'PINIT-DNA',
        version: config.dna.schemaVersion,
        dnaRecordId: dnaRecordId ?? null,
        generatedAt: new Date().toISOString(),
        schemaVersion: config.dna.schemaVersion,
        layer1HashRef: layer1Hash ?? null,
      };

      const claimsDigest = computeClaimsDigest({
        exifData: exifData as Record<string, unknown> | null,
        layer1HashRef: layer1Hash ?? null,
        tool: provenance.tool,
        version: provenance.version,
      });

      const metadataHash = deterministic
        ? claimsDigest
        : crypto
            .createHash('sha256')
            .update(
              JSON.stringify({
                exif: exifData ? this.sortKeys(exifData as Record<string, unknown>) : null,
                dnaRecordId: provenance.dnaRecordId,
                layer1HashRef: provenance.layer1HashRef,
                tool: provenance.tool,
                version: provenance.version,
              }),
            )
            .digest('hex');

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
          claimsDigest,
          claimsDigestAlgorithmId: CLAIMS_DIGEST_ALGORITHM_ID,
          deterministic,
        },
      };

      logIdentityLayerCompleted({
        layer: 5,
        name: this.layerName,
        durationMs: result.processingMs,
        fingerprintLength: metadataHash.length,
        success: true,
        deterministic,
      });

      logger.debug('Layer 5 — complete', {
        hasExif: !!exifData,
        imageWidth: sharpMeta.width,
        imageHeight: sharpMeta.height,
        metadataHash: metadataHash.substring(0, 16) + '...',
        claimsDigest: claimsDigest.substring(0, 16) + '...',
        deterministic,
        processingMs: result.processingMs,
      });

      return result;
    } catch (err) {
      logger.error('Layer 5 — failed', { error: err });
      logIdentityLayerCompleted({
        layer: 5,
        name: this.layerName,
        durationMs: Date.now() - start,
        fingerprintLength: 0,
        success: false,
        deterministic,
      });
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
    if (probe.metadataHash === stored.metadataHash) return 1.0;

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
    return Math.min(score, 1.0);
  }

  private async parseExif(buffer: Buffer): Promise<Record<string, unknown> | null> {
    try {
      const exifr = await import('exifr');
      const data = await exifr.default.parse(buffer, {
        tiff: true, xmp: true, iptc: true, gps: true,
        translateKeys: true, translateValues: true,
      });
      return data ?? null;
    } catch {
      return null;
    }
  }

  private getString(data: Record<string, unknown> | null, keys: string[]): string | undefined {
    if (!data) return undefined;
    for (const key of keys) {
      const val = data[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return undefined;
  }

  private getNumber(data: Record<string, unknown> | null, keys: string[]): number | undefined {
    if (!data) return undefined;
    for (const key of keys) {
      const val = data[key];
      if (typeof val === 'number' && isFinite(val)) return val;
    }
    return undefined;
  }

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

  private sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = obj[key];
        return acc;
      }, {});
  }
}
