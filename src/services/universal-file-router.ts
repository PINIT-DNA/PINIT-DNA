/**
 * PINIT-DNA — Universal File Router
 *
 * Single entry point for all DNA generation in the Universal engine.
 *
 * Flow:
 *   FileInput → detect file type → enforce engine gate → route to engine
 *               → return UniversalRouterResult
 *
 * Phase 0 : IMAGE  (existing DnaOrchestrator — unchanged)
 * Phase 1 : TXT, CSV, JSON
 * Phase 2+: PDF, DOCX, PPTX, ZIP, VIDEO, AUDIO (stubs ready)
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';

import { FileTypeDetector, DetectionResult } from './file-type-detector';
import { DnaOrchestrator } from './dna.orchestrator';
import { TxtDnaEngine }  from './engines/txt/txt-dna-engine';
import { CsvDnaEngine }  from './engines/csv/csv-dna-engine';
import { JsonDnaEngine } from './engines/json/json-dna-engine';
import { PdfDnaEngine }   from './engines/pdf/pdf-dna-engine';
import { DocxDnaEngine }  from './engines/docx/docx-dna-engine';
import { PptxDnaEngine }  from './engines/pptx/pptx-dna-engine';
import { ZipDnaEngine }   from './engines/zip/zip-dna-engine';
import { VideoDnaEngine } from './engines/video/video-dna-engine';
import { AudioDnaEngine } from './engines/audio/audio-dna-engine';
import { ImageInput } from '../types/dna.types';
import { UniversalRouterResult } from '../types/universal-engine.types';
import { BehavioralLayer }  from './layers/layer7.behavioral';
import { RelationshipLayer } from './layers/layer8.relationship';
import { OriginLayer }       from './layers/layer9.origin';
import { EvolutionLayer }    from './layers/layer10.evolution';

// ─── Universal input type ────────────────────────────────────────────────────

export interface FileInput {
  filePath: string;
  originalName: string;
  /** MIME type as declared by the browser / OS */
  declaredMimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

// ─── Engine version ───────────────────────────────────────────────────────────

export const UNIVERSAL_ENGINE_VERSION = '2.0.0-universal';

// ─── Router ───────────────────────────────────────────────────────────────────

export class UniversalFileRouter {
  private readonly detector    = new FileTypeDetector();
  private readonly imageEngine    = new DnaOrchestrator();
  private readonly layer7Behavioral  = new BehavioralLayer();
  private readonly layer8Relationship = new RelationshipLayer();
  private readonly layer9Origin       = new OriginLayer();
  private readonly layer10Evolution   = new EvolutionLayer();
  private readonly txtEngine   = new TxtDnaEngine();
  private readonly csvEngine   = new CsvDnaEngine();
  private readonly jsonEngine  = new JsonDnaEngine();
  private readonly pdfEngine   = new PdfDnaEngine();
  private readonly docxEngine  = new DocxDnaEngine();
  private readonly pptxEngine  = new PptxDnaEngine();
  private readonly zipEngine   = new ZipDnaEngine();
  private readonly videoEngine = new VideoDnaEngine();
  private readonly audioEngine = new AudioDnaEngine();

  async route(file: FileInput): Promise<UniversalRouterResult> {
    // ── Detect file type ──────────────────────────────────────────────────────
    const detection = await this.detector.detect(
      file.buffer, file.originalName, file.declaredMimeType
    );

    logger.info('Universal router: file type detected', {
      fileType: detection.fileType, mimeType: detection.mimeType,
      detectedBy: detection.detectedBy, confidence: detection.confidence,
      engineStatus: detection.config.engineStatus, file: file.originalName,
    });

    // ── Engine gate ───────────────────────────────────────────────────────────
    if (detection.config.engineStatus !== 'LIVE') {
      throw new Error(
        `DNA engine for "${detection.config.displayName}" is not yet available. ` +
        `Planned for Phase ${detection.config.plannedPhase}. ` +
        `Currently supported: IMAGE, TXT, CSV, JSON, PDF, DOCX, PPTX, ZIP, VIDEO, AUDIO.`
      );
    }

    // ── Route ─────────────────────────────────────────────────────────────────
    switch (detection.fileType) {
      case 'IMAGE':
        return this.routeImage(file, detection);

      case 'TXT':
        return this.routeText('TXT', file, detection,
          (id) => this.txtEngine.generate(file, id));

      case 'CSV':
        return this.routeText('CSV', file, detection,
          (id) => this.csvEngine.generate(file, id));

      case 'JSON':
        return this.routeText('JSON', file, detection,
          (id) => this.jsonEngine.generate(file, id));

      // ── Phase 2: Document engines ─────────────────────────────────────────
      case 'PDF':
        return this.routeText('PDF',  file, detection,
          (id) => this.pdfEngine.generate(file, id));
      case 'DOCX':
        return this.routeText('DOCX', file, detection,
          (id) => this.docxEngine.generate(file, id));
      case 'PPTX':
        return this.routeText('PPTX', file, detection,
          (id) => this.pptxEngine.generate(file, id));
      case 'ZIP':
        return this.routeText('ZIP',   file, detection, (id) => this.zipEngine.generate(file, id));
      case 'VIDEO':
        return this.routeText('VIDEO', file, detection, (id) => this.videoEngine.generate(file, id));
      case 'AUDIO':
        return this.routeText('AUDIO', file, detection, (id) => this.audioEngine.generate(file, id));

      default:
        throw new Error(`No DNA engine registered for file type: ${detection.fileType}`);
    }
  }

  // ─── IMAGE adapter ────────────────────────────────────────────────────────

  private async routeImage(
    file: FileInput,
    detection: DetectionResult
  ): Promise<UniversalRouterResult> {
    const imageInput: ImageInput = {
      filePath: file.filePath, originalName: file.originalName,
      mimeType: detection.mimeType, sizeBytes: file.sizeBytes, buffer: file.buffer,
    };

    const result = await this.imageEngine.generate(imageInput, {
      fileType: 'IMAGE', engineVersion: UNIVERSAL_ENGINE_VERSION,
    });

    const successful = Object.values(result.layers).filter(l => l.success).length;

    return {
      dnaRecordId:         result.dnaRecordId,
      schemaVersion:       result.schemaVersion,
      fileType:            'IMAGE',
      engineVersion:       UNIVERSAL_ENGINE_VERSION,
      detectedBy:          detection.detectedBy,
      detectionConfidence: detection.confidence,
      status:              result.status,
      totalProcessingMs:   result.totalProcessingMs,
      generatedAt:         result.generatedAt,
      layerSummary: { total: 10, successful, failed: 10 - successful },
    };
  }

  // ─── Universal text/data adapter ─────────────────────────────────────────

  /**
   * Generic adapter for all Phase 1+ text-based engines.
   * Creates the DnaRecord, runs the engine, returns a UniversalRouterResult.
   */
  private async routeText(
    fileType: string,
    file: FileInput,
    detection: DetectionResult,
    runEngine: (id: string) => Promise<{ layers: { success: boolean }[]; status: string; totalProcessingMs: number; generatedAt: Date }>
  ): Promise<UniversalRouterResult> {
    const dnaRecordId = uuidv4();
    const sha256Hash  = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Create PENDING record so the engine can update it
    await prisma.dnaRecord.create({
      data: {
        id: dnaRecordId,
        imageFilename:  file.originalName,
        imageMimeType:  detection.mimeType,
        imageSizeBytes: file.sizeBytes,
        schemaVersion:  config.dna.schemaVersion,
        status:         'PENDING',
        fileType,
        engineVersion:  UNIVERSAL_ENGINE_VERSION,
        sha256Hash,
      },
    });

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId }, data: { status: 'PROCESSING' },
    });

    const result = await runEngine(dnaRecordId);
    const uploadStartMs = Date.now();

    // Build a minimal ImageInput-compatible object so L7–L10 can run on any file type
    const fileAsImage: ImageInput = {
      filePath:     file.filePath,
      originalName: file.originalName,
      mimeType:     file.declaredMimeType,
      sizeBytes:    file.sizeBytes,
      buffer:       file.buffer,
    };

    // Run L7–L10 in parallel — these are file-type-agnostic
    const [l7, l8, l9, l10] = await Promise.allSettled([
      this.layer7Behavioral.generate(fileAsImage, dnaRecordId, uploadStartMs, undefined, undefined),
      this.layer8Relationship.generate(fileAsImage, dnaRecordId, sha256Hash),
      this.layer9Origin.generate(fileAsImage, dnaRecordId, {}),
      this.layer10Evolution.generate(fileAsImage, dnaRecordId, sha256Hash),
    ]);

    const extraLayers = [l7, l8, l9, l10].map(r => ({
      success: r.status === 'fulfilled' && r.value.success,
    }));

    // Persist L7–L10 results
    await prisma.$transaction(async (tx) => {
      if (l7.status === 'fulfilled' && l7.value.success) {
        await tx.behavioralLayer.create({ data: { dnaRecordId, behaviorHash: l7.value.data.behaviorHash, uploadMs: l7.value.data.uploadMs, sessionToken: l7.value.data.sessionToken ?? null, userAgent: l7.value.data.userAgent, processingMs: l7.value.processingMs } });
      }
      if (l8.status === 'fulfilled' && l8.value.success) {
        await tx.relationshipLayer.create({ data: { dnaRecordId, graphHash: l8.value.data.graphHash, relatedIds: l8.value.data.relatedIds, relationTypes: l8.value.data.relationTypes, processingMs: l8.value.processingMs } });
      }
      if (l9.status === 'fulfilled' && l9.value.success) {
        await tx.originLayer.create({ data: { dnaRecordId, originBundle: l9.value.data.originBundle as any, bundleHash: l9.value.data.bundleHash, processingMs: l9.value.processingMs } });
      }
      if (l10.status === 'fulfilled' && l10.value.success) {
        await tx.evolutionLayer.create({ data: { dnaRecordId, merkleRoot: l10.value.data.merkleRoot, mutationLog: l10.value.data.mutationLog as any, version: l10.value.data.version, processingMs: l10.value.processingMs } });
      }
    });

    const allLayers = [...result.layers, ...extraLayers];
    const successful = allLayers.filter(l => l.success).length;
    const status = successful === 10 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';

    // Update final status
    await prisma.dnaRecord.update({ where: { id: dnaRecordId }, data: { status } });

    return {
      dnaRecordId,
      schemaVersion:       config.dna.schemaVersion,
      fileType,
      engineVersion:       UNIVERSAL_ENGINE_VERSION,
      detectedBy:          detection.detectedBy,
      detectionConfidence: detection.confidence,
      status,
      totalProcessingMs:   result.totalProcessingMs,
      generatedAt:         result.generatedAt,
      layerSummary: { total: 10, successful, failed: 10 - successful },
    };
  }
}
