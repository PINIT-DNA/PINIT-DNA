/**
 * PINIT-DNA — Ephemeral Fingerprinter (Phase 3.1)
 *
 * Generates DNA fingerprints for a file WITHOUT permanently storing anything.
 *
 * Strategy:
 *   1. Create a temporary DnaRecord (UUID) in the DB with status PENDING
 *   2. Run the existing DNA engine for the detected file type
 *      (engines write their results to the temp record)
 *   3. Read fingerprints back from DB
 *   4. Delete the temp record and any temp carrier files from disk
 *
 * This reuses ALL existing engine code with zero duplication.
 * Nothing is left in the DB or on disk after cleanup.
 */

import path from 'path';
import fs   from 'fs/promises';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma }  from '../../lib/prisma';
import { logger }  from '../../lib/logger';
import { config }  from '../../config';

import { FileTypeDetector }  from '../file-type-detector';
import { DnaOrchestrator }   from '../dna.orchestrator';
import { UNIVERSAL_ENGINE_VERSION } from '../universal-file-router';

import { TxtDnaEngine }   from '../engines/txt/txt-dna-engine';
import { CsvDnaEngine }   from '../engines/csv/csv-dna-engine';
import { JsonDnaEngine }  from '../engines/json/json-dna-engine';
import { PdfDnaEngine }   from '../engines/pdf/pdf-dna-engine';
import { DocxDnaEngine }  from '../engines/docx/docx-dna-engine';
import { PptxDnaEngine }  from '../engines/pptx/pptx-dna-engine';
import { ZipDnaEngine }   from '../engines/zip/zip-dna-engine';
import { VideoDnaEngine } from '../engines/video/video-dna-engine';
import { AudioDnaEngine } from '../engines/audio/audio-dna-engine';

import type { FileInput } from '../universal-file-router';
import type { UniversalLayerResult } from '../../types/universal-engine.types';
import { computeHmac } from '../engines/base/text-utils';

// ─── Output type ──────────────────────────────────────────────────────────────

export interface EphemeralLayer {
  layer: number;
  name: string;
  implementation: string;
  fingerprint: string;
  data: Record<string, unknown>;
  success: boolean;
}

export interface EphemeralFingerprint {
  fileType: string;
  mimeType: string;
  filename: string;
  sizeBytes: number;
  detectedBy: string;
  layers: EphemeralLayer[];
}

// ─── Fingerprinter ────────────────────────────────────────────────────────────

export class EphemeralFingerprinter {
  private readonly detector = new FileTypeDetector();

  async fingerprint(file: FileInput): Promise<EphemeralFingerprint> {
    // ── Detect file type ──────────────────────────────────────────────────────
    const detection = await this.detector.detect(
      file.buffer, file.originalName, file.declaredMimeType
    );

    logger.info('Ephemeral fingerprint started', {
      file: file.originalName, fileType: detection.fileType,
    });

    // ── IMAGE is handled separately because DnaOrchestrator creates its own
    // UUID internally — we cannot pass a pre-existing tempId to it.
    if (detection.fileType === 'IMAGE') {
      return this.fingerprintImage(file, detection);
    }

    // ── Non-image: create temp record, run engine, read back, clean up ────────
    const tempId = uuidv4();

    try {
      await prisma.dnaRecord.create({
        data: {
          id:             tempId,
          imageFilename:  file.originalName,
          imageMimeType:  detection.mimeType,
          imageSizeBytes: file.sizeBytes,
          schemaVersion:  config.dna.schemaVersion,
          status:         'PROCESSING',
          fileType:       detection.fileType,
          engineVersion:  UNIVERSAL_ENGINE_VERSION,
        },
      });

      await this.runNonImageEngine(detection.fileType, file, tempId);

      const layers = await this.readUniversalLayers(tempId);
      const stable = this.stabiliseL6(layers, detection.fileType);

      logger.info('Ephemeral fingerprint complete', {
        file: file.originalName, fileType: detection.fileType, layers: stable.length,
      });

      return {
        fileType:   detection.fileType,
        mimeType:   detection.mimeType,
        filename:   file.originalName,
        sizeBytes:  file.sizeBytes,
        detectedBy: detection.detectedBy,
        layers:     stable,
      };
    } finally {
      await this.cleanup(tempId);
    }
  }

  // ─── IMAGE: Let DnaOrchestrator manage its own record ────────────────────

  /**
   * For IMAGE files, DnaOrchestrator.generate() creates its own UUID internally.
   * We call it directly, capture the returned dnaRecordId, read image layer
   * tables using that ID, then clean up.
   */
  private async fingerprintImage(
    file: FileInput,
    detection: { mimeType: string; detectedBy: string; fileType: string }
  ): Promise<EphemeralFingerprint> {
    const imageInput = {
      filePath:     file.filePath,
      originalName: file.originalName,
      mimeType:     detection.mimeType,
      sizeBytes:    file.sizeBytes,
      buffer:       file.buffer,
    };

    // Orchestrator creates its own DnaRecord and all layer sub-records
    const result = await new DnaOrchestrator().generate(imageInput, {
      fileType: 'IMAGE', engineVersion: UNIVERSAL_ENGINE_VERSION,
    });

    const orcId = result.dnaRecordId; // The ID the orchestrator actually used

    try {
      const layers = await this.readImageLayers(orcId);
      const stable = this.stabiliseL6(layers, 'IMAGE');

      logger.info('Ephemeral IMAGE fingerprint complete', {
        file: file.originalName, layers: stable.length,
      });

      return {
        fileType:   'IMAGE',
        mimeType:   detection.mimeType,
        filename:   file.originalName,
        sizeBytes:  file.sizeBytes,
        detectedBy: detection.detectedBy,
        layers:     stable,
      };
    } finally {
      await this.cleanup(orcId);
    }
  }

  // ─── Non-image engine dispatch ────────────────────────────────────────────

  private async runNonImageEngine(
    fileType: string,
    file: FileInput,
    tempId: string
  ): Promise<void> {
    switch (fileType) {
      case 'TXT':   await new TxtDnaEngine().generate(file, tempId);   break;
      case 'CSV':   await new CsvDnaEngine().generate(file, tempId);   break;
      case 'JSON':  await new JsonDnaEngine().generate(file, tempId);  break;
      case 'PDF':   await new PdfDnaEngine().generate(file, tempId);   break;
      case 'DOCX':  await new DocxDnaEngine().generate(file, tempId);  break;
      case 'PPTX':  await new PptxDnaEngine().generate(file, tempId);  break;
      case 'ZIP':   await new ZipDnaEngine().generate(file, tempId);   break;
      case 'VIDEO': await new VideoDnaEngine().generate(file, tempId); break;
      case 'AUDIO': await new AudioDnaEngine().generate(file, tempId); break;
      default:
        throw new Error(`Ephemeral fingerprinter: no engine for type "${fileType}"`);
    }
  }

  // ─── Read fingerprints from DB ────────────────────────────────────────────

  /**
   * Replaces the L6 fingerprint with a content-stable HMAC.
   *
   * In normal DNA generation, L6 is HMAC(fileType:recordId:L1-L5 fingerprints).
   * The recordId is a random UUID per generation → two identical files get
   * different L6 values, making comparison impossible.
   *
   * In comparison mode, L6 = HMAC(fileType:L1-L5 fingerprints) — same content
   * always produces the same comparison-L6, regardless of which run created it.
   */
  private stabiliseL6(layers: EphemeralLayer[], fileType: string): EphemeralLayer[] {
    const l1to5 = layers.slice(0, 5).filter(l => l.success).map(l => l.fingerprint).join('|');
    const stableHmac = computeHmac(`COMPARE:${fileType}:${l1to5}`, config.stego.signatureSecret);
    return layers.map(l =>
      l.layer === 6 ? { ...l, fingerprint: stableHmac, data: { ...l.data, comparisonHmac: stableHmac, note: 'Stabilised for comparison (content-based, not record-ID-based)' } } : l
    );
  }

  /** IMAGE: fingerprints stored in separate layer tables */
  private async readImageLayers(tempId: string): Promise<EphemeralLayer[]> {
    const record = await prisma.dnaRecord.findUnique({
      where: { id: tempId },
      include: {
        cryptoLayer: true, structuralLayer: true, perceptualLayer: true,
        semanticLayer: true, metadataLayer: true, stegoLayer: true,
        behavioralLayer: true, relationshipLayer: true, originLayer: true, evolutionLayer: true,
      },
    });

    const layers: EphemeralLayer[] = [];

    if (record?.cryptoLayer) {
      layers.push({
        layer: 1, name: 'cryptographic', implementation: 'sha256_normalized',
        fingerprint: record.cryptoLayer.sha256Hash,
        data: {
          sha256Hash:     record.cryptoLayer.sha256Hash,
          normalizedHash: record.cryptoLayer.normalizedHash,
          blake3Hash:     record.cryptoLayer.blake3Hash,
        },
        success: true,
      });
    }

    if (record?.structuralLayer) {
      layers.push({
        layer: 2, name: 'structural', implementation: 'sobel_edge_detection',
        fingerprint: record.structuralLayer.edgeSignature64,
        data: {
          edgeSignature64: record.structuralLayer.edgeSignature64,
          algorithm:       record.structuralLayer.algorithm,
        },
        success: true,
      });
    }

    if (record?.perceptualLayer) {
      layers.push({
        layer: 3, name: 'perceptual', implementation: 'dct_phash',
        fingerprint: record.perceptualLayer.pHash64,
        data: {
          pHash64:  record.perceptualLayer.pHash64,
          pHash256: record.perceptualLayer.pHash256,
          aHash64:  record.perceptualLayer.aHash64,
          dHash64:  record.perceptualLayer.dHash64,
        },
        success: true,
      });
    }

    if (record?.semanticLayer) {
      layers.push({
        layer: 4, name: 'semantic', implementation: 'rgb_hsv_histogram',
        fingerprint: record.semanticLayer.colorFingerprint,
        data: { colorFingerprint: record.semanticLayer.colorFingerprint },
        success: true,
      });
    }

    if (record?.metadataLayer) {
      // L5: The stored metadataHash includes dnaRecordId (non-deterministic across runs).
      // Recompute a STABLE fingerprint from just the EXIF content fields so that
      // comparing the same file twice always gives 100% similarity on L5.
      const stableL5 = crypto.createHash('sha256').update(JSON.stringify({
        deviceMake:  record.metadataLayer.deviceMake,
        deviceModel: record.metadataLayer.deviceModel,
        capturedAt:  record.metadataLayer.capturedAt?.toISOString() ?? null,
        gpsLat:      record.metadataLayer.gpsLatitude,
        gpsLon:      record.metadataLayer.gpsLongitude,
      })).digest('hex');

      layers.push({
        layer: 5, name: 'metadata', implementation: 'exif_metadata_stable',
        fingerprint: stableL5,
        data: {
          stableFingerprint: stableL5,
          deviceMake:   record.metadataLayer.deviceMake,
          deviceModel:  record.metadataLayer.deviceModel,
          capturedAt:   record.metadataLayer.capturedAt?.toISOString() ?? null,
          gpsLatitude:  record.metadataLayer.gpsLatitude,
          gpsLongitude: record.metadataLayer.gpsLongitude,
        },
        success: true,
      });
    }

    if (record?.stegoLayer) {
      layers.push({
        layer: 6, name: 'signature', implementation: 'lsb_steganography_hmac',
        fingerprint: record.stegoLayer.payloadHmac,
        data: {
          payloadHmac: record.stegoLayer.payloadHmac,
          embedded:    record.stegoLayer.embedded,
          channel:     record.stegoLayer.channel,
        },
        success: true,
      });
    }

    if (record?.behavioralLayer) {
      layers.push({
        layer: 7, name: 'behavioral', implementation: 'sha256_behavior_bundle',
        fingerprint: record.behavioralLayer.behaviorHash,
        data: { behaviorHash: record.behavioralLayer.behaviorHash, uploadMs: record.behavioralLayer.uploadMs },
        success: true,
      });
    }

    if (record?.relationshipLayer) {
      layers.push({
        layer: 8, name: 'relationship', implementation: 'sha256_graph_hash',
        fingerprint: record.relationshipLayer.graphHash ?? '',
        data: { graphHash: record.relationshipLayer.graphHash, relatedIds: record.relationshipLayer.relatedIds },
        success: true,
      });
    }

    if (record?.originLayer) {
      layers.push({
        layer: 9, name: 'origin', implementation: 'sha256_origin_bundle',
        fingerprint: record.originLayer.bundleHash,
        data: { bundleHash: record.originLayer.bundleHash },
        success: true,
      });
    }

    if (record?.evolutionLayer) {
      layers.push({
        layer: 10, name: 'evolution', implementation: 'merkle_mutation_log',
        fingerprint: record.evolutionLayer.merkleRoot ?? '',
        data: { merkleRoot: record.evolutionLayer.merkleRoot, version: record.evolutionLayer.version },
        success: true,
      });
    }

    // Pad any missing layers as failed (L1–L15)
    for (let i = layers.length + 1; i <= 15; i++) {
      layers.push({
        layer: i, name: `layer${i}`, implementation: 'missing',
        fingerprint: '', data: {}, success: false,
      });
    }

    return layers;
  }

  /** Non-IMAGE: L1–L6 from universalFingerprints JSON, L7–L10 from separate tables */
  private async readUniversalLayers(tempId: string): Promise<EphemeralLayer[]> {
    const record = await prisma.dnaRecord.findUnique({
      where: { id: tempId },
      select: {
        universalFingerprints: true,
        behavioralLayer: true, relationshipLayer: true,
        originLayer: true, evolutionLayer: true,
      },
    });

    const fp = record?.universalFingerprints as unknown as
      { layers: UniversalLayerResult[] } | null;

    const layers: EphemeralLayer[] = (fp?.layers ?? []).map((l) => ({
      layer:          l.layer,
      name:           l.name,
      implementation: l.implementation,
      fingerprint:    l.fingerprint,
      data:           l.data,
      success:        l.success,
    }));

    if (record?.behavioralLayer) {
      layers.push({ layer: 7, name: 'behavioral', implementation: 'sha256_behavior_bundle', fingerprint: record.behavioralLayer.behaviorHash, data: { behaviorHash: record.behavioralLayer.behaviorHash }, success: true });
    }
    if (record?.relationshipLayer) {
      layers.push({ layer: 8, name: 'relationship', implementation: 'sha256_graph_hash', fingerprint: record.relationshipLayer.graphHash ?? '', data: { graphHash: record.relationshipLayer.graphHash }, success: true });
    }
    if (record?.originLayer) {
      layers.push({ layer: 9, name: 'origin', implementation: 'sha256_origin_bundle', fingerprint: record.originLayer.bundleHash, data: { bundleHash: record.originLayer.bundleHash }, success: true });
    }
    if (record?.evolutionLayer) {
      layers.push({ layer: 10, name: 'evolution', implementation: 'merkle_mutation_log', fingerprint: record.evolutionLayer.merkleRoot ?? '', data: { merkleRoot: record.evolutionLayer.merkleRoot }, success: true });
    }

    return layers;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  private async cleanup(tempId: string): Promise<void> {
    try {
      // Delete the temp DB record (cascades to all layer rows)
      await prisma.dnaRecord.delete({ where: { id: tempId } });
    } catch {
      logger.warn('Ephemeral fingerprinter: DB cleanup failed', { tempId });
    }

    // Delete any temp carrier files written by image layers (L2/L6)
    const patterns = [
      `carrier_l2_${tempId}.png`,
      `carrier_${tempId}.png`,
      `dna_${tempId}`,
    ];

    for (const pattern of patterns) {
      const filePath = path.join(config.upload.tempDir, pattern);
      await fs.unlink(filePath).catch(() => { /* file may not exist */ });
    }

    // Also clean up L6 carrier in vault carrier dir if it exists
    const vaultCarrier = path.join(config.vault.storageDir, `${tempId}.png`);
    await fs.unlink(vaultCarrier).catch(() => {});
  }
}
