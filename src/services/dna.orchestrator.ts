/**
 * PINIT-DNA — DNA Orchestrator
 *
 * Coordinates the 6-layer fingerprint generation pipeline.
 * Each layer runs independently; partial failures do not abort the pipeline.
 * The orchestrator persists the result to the database and returns the record ID.
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';

import { CryptographicLayer } from './layers/layer1.cryptographic';
import { StructuralLayer } from './layers/layer2.structural';
import { PerceptualLayer } from './layers/layer3.perceptual';
import { SemanticLayer } from './layers/layer4.semantic';
import { MetadataLayer } from './layers/layer5.metadata';
import { SteganographyLayer } from './layers/layer6.steganography';
import { processAdvancedLayers } from './layers/layers-11-15.service';
import { TOTAL_DNA_LAYERS } from '../constants/dna-layers';
import { BehavioralLayer } from './layers/layer7.behavioral';
import { RelationshipLayer } from './layers/layer8.relationship';
import { OriginLayer } from './layers/layer9.origin';
import { EvolutionLayer } from './layers/layer10.evolution';

import {
  ImageInput,
  DnaGenerationResult,
  CryptoLayerResult,
  StructuralLayerResult,
  PerceptualLayerResult,
  SemanticLayerResult,
  MetadataLayerResult,
  StegoLayerResult,
  BehavioralLayerResult,
  RelationshipLayerResult,
  OriginLayerResult,
  EvolutionLayerResult,
} from '../types/dna.types';
import { withTimeout, withTimeoutSoft, validateFileInput } from '../lib/safe-runner';
import { Prisma } from '@prisma/client';
import { buildEnhancementBundle, mergeUniversalFingerprints } from './forensics/dna-enhancement-bundle.service';
import {
  buildIdentityDeterministicPackage,
  CLAIMS_DIGEST_ALGORITHM_ID,
  CONTENT_SEAL_ALGORITHM_ID,
  mergeIdentityDeterministicPackage,
} from './dna/deterministic-identity';
import { persistEnterpriseDnaPackage } from './dna/enterprise-dna-package.service';

export class DnaOrchestrator {
  private readonly layer1  = new CryptographicLayer();
  private readonly layer2  = new StructuralLayer();
  private readonly layer3  = new PerceptualLayer();
  private readonly layer4  = new SemanticLayer();
  private readonly layer5  = new MetadataLayer();
  private readonly layer6  = new SteganographyLayer();
  private readonly layer7  = new BehavioralLayer();
  private readonly layer8  = new RelationshipLayer();
  private readonly layer9  = new OriginLayer();
  private readonly layer10 = new EvolutionLayer();

  /**
   * Run the full 6-layer DNA generation pipeline for an uploaded image.
   *
   * Layers 1–5 run in parallel for performance.
   * Layer 6 (steganography) runs last because it embeds the record ID.
   *
   * @param image        - Loaded image input (buffer + metadata)
   * @param universalCtx - Optional fields injected by the UniversalFileRouter
   * @returns DnaGenerationResult — complete 6-layer record, not yet persisted
   */
  async generate(
    image: ImageInput,
    universalCtx?: {
      fileType?: string;
      engineVersion?: string;
      uploadStartMs?: number;
      userAgent?: string;
      sessionToken?: string;
      ip?: string;
      country?: string;
      city?: string;
      ownerUserId?: string;
      gpsLatitude?: number;
      gpsLongitude?: number;
      locationShared?: boolean;
      /** Skip the expensive dense per-pixel (4E) spatial-auth pass — HKCA (3A)
       * still runs. Used by document page protection, where 4E's ~40s/17MB
       * cost multiplies by page count for marginal extra tamper-localization
       * value over what HKCA + local-DNA patches already provide. */
      skipSpatialPixel1?: boolean;
    }
  ): Promise<DnaGenerationResult> {
    const pipelineStart = Date.now();
    const dnaRecordId = uuidv4();

    // Phase 4: validate file safety before any processing
    validateFileInput(image.buffer, image.originalName, 500 * 1024 * 1024);

    logger.info('DNA generation started', {
      dnaRecordId,
      file: image.originalName,
      sizeBytes: image.sizeBytes,
    });

    // ── Create PROCESSING record immediately so callers can poll status
    const sha256Hash = crypto.createHash('sha256').update(image.buffer).digest('hex');
    await prisma.dnaRecord.create({
      data: {
        id:              dnaRecordId,
        imageFilename:   image.originalName,
        imageMimeType:   image.mimeType,
        imageSizeBytes:  image.sizeBytes,
        schemaVersion:   config.dna.schemaVersion,
        status:          'PROCESSING',
        sha256Hash,
        ownerUserId:     universalCtx?.ownerUserId ?? null,
        fileType:        universalCtx?.fileType    ?? null,
        engineVersion:   universalCtx?.engineVersion ?? null,
      },
    });

    const tLayers = Date.now();
    // ── Run layers 1–4 in parallel ────────────────────────────────────────────
    const [cryptoResult, structuralResult, perceptualResult, semanticResult] =
      await Promise.all([
        this.runLayer(() => this.layer1.generate(image, sha256Hash), 'layer1'),
        this.runLayer(() => this.layer2.generate(image, dnaRecordId), 'layer2'),
        this.runLayer(() => this.layer3.generate(image), 'layer3'),
        this.runLayer(() => this.layer4.generate(image), 'layer4'),
      ]);

    // ── Layer 5 runs after Layer 1 — embeds a cryptographic link to L1 hash ──
    const layer1HashForMeta = (cryptoResult as CryptoLayerResult).data?.sha256Hash;
    const metadataResult = await this.runLayer(
      () => this.layer5.generate(image, dnaRecordId, layer1HashForMeta),
      'layer5'
    );

    // ── Layer 6 — EDS content seal uses L1–L5 digests; LSB trace stays ownership-only
    const digestsL1toL5 = [
      (cryptoResult as CryptoLayerResult).data?.sha256Hash ?? sha256Hash,
      (structuralResult as StructuralLayerResult).data?.edgeSignature64 ?? '',
      (perceptualResult as PerceptualLayerResult).data?.pHash64 ?? '',
      (semanticResult as SemanticLayerResult).data?.colorFingerprint ?? '',
      (metadataResult as MetadataLayerResult).data?.metadataHash ?? '',
    ];
    const stegoResult = await this.runLayer(
      () => this.layer6.generate(image, dnaRecordId, digestsL1toL5, {
        dnaRecordId,
        ownerUserId: universalCtx?.ownerUserId ?? null,
        vaultId: dnaRecordId,
        filename: image.originalName,
        mimeType: image.mimeType,
        uploadedAt: new Date(),
        ip: universalCtx?.ip ?? null,
        country: universalCtx?.country ?? null,
        city: universalCtx?.city ?? null,
        userAgent: universalCtx?.userAgent ?? null,
        sessionToken: universalCtx?.sessionToken ?? null,
      }),
      'layer6'
    );

    // ── Layers 7–10 — identity fingerprints content-only when deterministic ──
    const layer1Hash = (cryptoResult as CryptoLayerResult).data?.sha256Hash ?? sha256Hash;
    const perceptualPrimary = (perceptualResult as PerceptualLayerResult).data?.pHash64 ?? '';
    const [behavioralResult, relationshipResult, originResult, evolutionResult] =
      await Promise.all([
        this.runLayer(
          () => this.layer7.generate(
            image, dnaRecordId,
            universalCtx?.uploadStartMs ?? Date.now(),
            universalCtx?.userAgent,
            universalCtx?.sessionToken,
            { contentId: layer1Hash, perceptualPrimary },
          ), 'layer7'
        ),
        this.runLayer(
          () => this.layer8.generate(image, dnaRecordId, layer1Hash, perceptualPrimary),
          'layer8'
        ),
        this.runLayer(
          () => this.layer9.generate(image, dnaRecordId, {
            ip:        universalCtx?.ip,
            userAgent: universalCtx?.userAgent,
            country:   universalCtx?.country,
            city:      universalCtx?.city,
          }, { contentId: layer1Hash }), 'layer9'
        ),
        this.runLayer(
          () => this.layer10.generate(image, dnaRecordId, layer1Hash),
          'layer10'
        ),
      ]);

    // ── Determine overall status ──────────────────────────────────────────────
    const allLayers = [
      cryptoResult,
      structuralResult,
      perceptualResult,
      semanticResult,
      metadataResult,
      stegoResult,
      behavioralResult,
      relationshipResult,
      originResult,
      evolutionResult,
    ];

    const layerMs = Date.now() - tLayers;

    const successCount = allLayers.filter((l) => l.success).length;

    const tPersist = Date.now();
    // ── Persist layers 1–10 ───────────────────────────────────────────────────
    await this.persist(dnaRecordId, {
      crypto:       cryptoResult       as CryptoLayerResult,
      structural:   structuralResult   as StructuralLayerResult,
      perceptual:   perceptualResult   as PerceptualLayerResult,
      semantic:     semanticResult     as SemanticLayerResult,
      metadata:     metadataResult     as MetadataLayerResult,
      stego:        stegoResult        as StegoLayerResult,
      behavioral:   behavioralResult   as BehavioralLayerResult,
      relationship: relationshipResult as RelationshipLayerResult,
      origin:       originResult       as OriginLayerResult,
      evolution:    evolutionResult    as EvolutionLayerResult,
      status:       'PROCESSING',
    });

    const persistMs = Date.now() - tPersist;

    // Core L1–10 is enough to vault. L11–15 + optional enhancements finish in background.
    const status =
      successCount === 10 ? 'COMPLETE'
        : successCount > 0 ? 'PARTIAL'
        : 'FAILED';

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status },
    });

    const ownerUserId = universalCtx?.ownerUserId;
    if (ownerUserId) {
      const buf = image.buffer;
      const mime = image.mimeType;
      const name = image.originalName;
      void processAdvancedLayers(dnaRecordId, buf, mime, ownerUserId, name)
        .then(async (advanced) => {
          const totalSuccessful = successCount + advanced.successful;
          await prisma.dnaRecord.update({
            where: { id: dnaRecordId },
            data: {
              status:
                totalSuccessful === TOTAL_DNA_LAYERS ? 'COMPLETE'
                  : totalSuccessful > 0 ? 'PARTIAL'
                  : 'FAILED',
            },
          });
          logger.info('Layers 11–15 background complete', {
            dnaRecordId,
            advancedLayers: advanced.successful,
            totalSuccessful,
          });
        })
        .catch((err) => {
          logger.warn('Layers 11–15 background failed (non-fatal)', { dnaRecordId, error: String(err) });
        });
    }

    try {
      const metaData = (metadataResult as MetadataLayerResult).data;
      const stegoData = (stegoResult as StegoLayerResult).data;
      const identityPackage = buildIdentityDeterministicPackage({
        mediaType: 'IMAGE',
        contentId: layer1Hash,
        claimsDigest: metaData.claimsDigest ?? metaData.metadataHash,
        contentSealHmac: stegoData.contentSealHmac ?? stegoData.payloadHmac,
        stegoTraceHmac: stegoData.stegoTraceHmac,
        modules: [
          { moduleId: 1, fingerprint: layer1Hash, algorithmId: 'L1-sha256-v1', status: cryptoResult.success ? 'COMPLETE' : 'FAILED' },
          { moduleId: 2, fingerprint: (structuralResult as StructuralLayerResult).data?.edgeSignature64 ?? '', algorithmId: 'L2-sobel-8x8-v1', status: structuralResult.success ? 'COMPLETE' : 'FAILED' },
          { moduleId: 3, fingerprint: perceptualPrimary, algorithmId: 'L3-phash-dct-64-v1', status: perceptualResult.success ? 'COMPLETE' : 'FAILED' },
          { moduleId: 4, fingerprint: (semanticResult as SemanticLayerResult).data?.colorFingerprint ?? '', algorithmId: 'L4-hist-v1', status: semanticResult.success ? 'COMPLETE' : 'FAILED' },
          { moduleId: 5, fingerprint: metaData.claimsDigest ?? metaData.metadataHash, algorithmId: CLAIMS_DIGEST_ALGORITHM_ID, status: metadataResult.success ? 'COMPLETE' : 'FAILED' },
          { moduleId: 6, fingerprint: stegoData.contentSealHmac ?? stegoData.payloadHmac, algorithmId: CONTENT_SEAL_ALGORITHM_ID, status: stegoResult.success ? 'COMPLETE' : 'FAILED' },
          { moduleId: 7, fingerprint: (behavioralResult as BehavioralLayerResult).data?.behaviorHash ?? '', algorithmId: 'L7-content-v1', status: behavioralResult.success ? 'COMPLETE' : 'FAILED' },
          { moduleId: 8, fingerprint: (relationshipResult as RelationshipLayerResult).data?.graphHash ?? '', algorithmId: 'L8-family-v1', status: relationshipResult.success ? 'COMPLETE' : 'FAILED' },
          { moduleId: 9, fingerprint: (originResult as OriginLayerResult).data?.bundleHash ?? '', algorithmId: 'L9-xmod-v1', status: originResult.success ? 'COMPLETE' : 'FAILED' },
          { moduleId: 10, fingerprint: (evolutionResult as EvolutionLayerResult).data?.merkleRoot ?? '', algorithmId: 'L10-lineage-v1', status: evolutionResult.success ? 'COMPLETE' : 'FAILED' },
        ],
      });

      const rec = await prisma.dnaRecord.findUnique({
        where: { id: dnaRecordId },
        select: { universalFingerprints: true },
      });
      const fp = mergeIdentityDeterministicPackage(rec?.universalFingerprints, identityPackage);
      await prisma.dnaRecord.update({
        where: { id: dnaRecordId },
        data: { universalFingerprints: fp as Prisma.InputJsonValue },
      });
    } catch (err) {
      logger.warn('DNA identity package skipped (non-fatal)', { dnaRecordId, error: String(err) });
    }

    void (async () => {
      try {
        const enhancementBundle = await withTimeoutSoft(
          () => buildEnhancementBundle(image.buffer, {
            mimeType: image.mimeType,
            fileType: 'IMAGE',
            tempPath: image.filePath,
          }),
          8_000,
          'dna-enhancement-bundle',
        );
        if (!enhancementBundle) return;
        const rec = await prisma.dnaRecord.findUnique({
          where: { id: dnaRecordId },
          select: { universalFingerprints: true },
        });
        const fp = mergeUniversalFingerprints(rec?.universalFingerprints, enhancementBundle);
        await prisma.dnaRecord.update({
          where: { id: dnaRecordId },
          data: { universalFingerprints: fp as Prisma.InputJsonValue },
        });
      } catch (err) {
        logger.warn('DNA enhancement bundle skipped (non-fatal)', { dnaRecordId, error: String(err) });
      }
    })();

    void persistEnterpriseDnaPackage(dnaRecordId).catch((err) => {
      logger.warn('Enterprise DNA package persistence skipped (non-fatal)', {
        dnaRecordId,
        error: String(err),
      });
    });

    const totalMs = Date.now() - pipelineStart;

    logger.info('PROTECT_DNA', {
      dnaRecordId,
      status,
      coreLayers: successCount,
      layerMs,
      persistMs,
      totalMs,
      sizeBytes: image.sizeBytes,
    });

    // Vault store re-enrolls spatial auth on post-embed bytes. Skipping DNA-time
    // enroll avoids a full RGB decode + HKCA on the protect hot path.

    // Forensic provenance — only for registered assets (never ephemeral probe DNA)
    if (universalCtx?.ownerUserId) {
      try {
        const { forensicProvenanceService } = await import('./forensics/forensic-provenance.service');
        const hasGps = !!(
          universalCtx.locationShared
          && universalCtx.gpsLatitude != null
          && universalCtx.gpsLongitude != null
          && Number.isFinite(universalCtx.gpsLatitude)
          && Number.isFinite(universalCtx.gpsLongitude)
        );
        forensicProvenanceService.appendAsync({
          eventType: 'DNA_GENERATED',
          summary: hasGps
            ? `DNA generated — ${image.originalName} (location shared)`
            : `DNA generated — ${image.originalName}`,
          dnaRecordId,
          actorUserId: universalCtx.ownerUserId,
          userAgent: universalCtx?.userAgent ?? null,
          country: universalCtx?.country ?? null,
          city: universalCtx?.city ?? null,
          ipAddress: universalCtx?.ip ?? null,
          latitude: hasGps ? universalCtx.gpsLatitude : null,
          longitude: hasGps ? universalCtx.gpsLongitude : null,
          locationSource: hasGps ? 'gps' : universalCtx?.country ? 'ip' : 'none',
          payload: {
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            sha256: sha256Hash,
            status,
            schemaVersion: config.dna.schemaVersion,
            engineVersion: universalCtx?.engineVersion ?? null,
            locationShared: hasGps,
          },
          dedupeKey: `dna_generated:${dnaRecordId}`,
        });
      } catch {
        /* non-fatal */
      }

      import('./platform-events/module-events').then(({ emitDnaGenerated }) => {
        emitDnaGenerated({
          ownerUserId: universalCtx.ownerUserId!,
          dnaRecordId,
          filename: image.originalName,
          country: universalCtx?.country ?? null,
          ip: universalCtx?.ip ?? null,
        });
      }).catch(() => {});
    }

    const fileInfo = {
      filename: image.originalName,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      widthPx: null as number | null,
      heightPx: null as number | null,
    };

    return {
      dnaRecordId,
      schemaVersion: config.dna.schemaVersion,
      // "file" is the universal field; "image" is kept for backward compatibility
      file: fileInfo,
      image: fileInfo,
      layers: {
        crypto:       cryptoResult       as CryptoLayerResult,
        structural:   structuralResult   as StructuralLayerResult,
        perceptual:   perceptualResult   as PerceptualLayerResult,
        semantic:     semanticResult     as SemanticLayerResult,
        metadata:     metadataResult     as MetadataLayerResult,
        stego:        stegoResult        as StegoLayerResult,
        behavioral:   behavioralResult   as BehavioralLayerResult,
        relationship: relationshipResult as RelationshipLayerResult,
        origin:       originResult       as OriginLayerResult,
        evolution:    evolutionResult    as EvolutionLayerResult,
      },
      status,
      totalProcessingMs: totalMs,
      generatedAt: new Date(),
      layerSummary: {
        total: TOTAL_DNA_LAYERS,
        successful: successCount,
        failed: Math.max(0, 10 - successCount),
      },
    };
  }

  /**
   * Wrap a layer generator with:
   *   1. 30-second hard timeout (Phase 4 — safe runner)
   *   2. Error catch — never crashes the pipeline
   */
  private async runLayer<T extends { success: boolean }>(
    fn: () => Promise<T>,
    layerLabel: string
  ): Promise<T> {
    try {
      return await withTimeout(fn, 30_000, layerLabel);
    } catch (err) {
      logger.error(`Layer failed or timed out: ${layerLabel}`, { error: err });
      return { success: false, error: String(err) } as unknown as T;
    }
  }

  /**
   * Persist all layer results to the database inside a transaction.
   * Updates the DnaRecord status to COMPLETE, PARTIAL, or FAILED.
   */
  private async persist(
    dnaRecordId: string,
    layers: {
      crypto:       CryptoLayerResult;
      structural:   StructuralLayerResult;
      perceptual:   PerceptualLayerResult;
      semantic:     SemanticLayerResult;
      metadata:     MetadataLayerResult;
      stego:        StegoLayerResult;
      behavioral:   BehavioralLayerResult;
      relationship: RelationshipLayerResult;
      origin:       OriginLayerResult;
      evolution:    EvolutionLayerResult;
      status:       'COMPLETE' | 'PARTIAL' | 'FAILED' | 'PROCESSING';
    }
  ): Promise<void> {
    // Ephemeral investigation fingerprints on Render/Supabase often exceed the
    // default 5s interactive transaction budget (metadataLayer.create fails mid-write).
    await prisma.$transaction(async (tx) => {
      // ── Layer 1 ────────────────────────────────────────────────────────────
      if (layers.crypto.success) {
        await tx.cryptoLayer.create({
          data: {
            dnaRecordId,
            sha256Hash: layers.crypto.data.sha256Hash,
            normalizedHash: layers.crypto.data.normalizedHash,
            blake3Hash: layers.crypto.data.blake3Hash,
          },
        });
      }

      // ── Layer 2 ────────────────────────────────────────────────────────────
      if (layers.structural.success) {
        await tx.structuralLayer.create({
          data: {
            dnaRecordId,
            edgeMapB64: layers.structural.data.edgeMapB64,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            edgeVectors: layers.structural.data.edgeVectors as any,
            edgeSignature64: layers.structural.data.edgeSignature64,
            algorithm: layers.structural.data.algorithm,
          },
        });
      }

      // ── Layer 3 ────────────────────────────────────────────────────────────
      if (layers.perceptual.success) {
        await tx.perceptualLayer.create({
          data: {
            dnaRecordId,
            pHash64: layers.perceptual.data.pHash64,
            pHash256: layers.perceptual.data.pHash256,
            aHash64: layers.perceptual.data.aHash64,
            dHash64: layers.perceptual.data.dHash64,
          },
        });
      }

      // ── Layer 4 ────────────────────────────────────────────────────────────
      if (layers.semantic.success) {
        await tx.semanticLayer.create({
          data: {
            dnaRecordId,
            histogramR: layers.semantic.data.histogramR,
            histogramG: layers.semantic.data.histogramG,
            histogramB: layers.semantic.data.histogramB,
            histogramH: layers.semantic.data.histogramH,
            histogramS: layers.semantic.data.histogramS,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            dominantColors: layers.semantic.data.dominantColors as any,
            colorFingerprint: layers.semantic.data.colorFingerprint,
          },
        });
      }

      // ── Layer 5 ────────────────────────────────────────────────────────────
      if (layers.metadata.success) {
        await tx.metadataLayer.create({
          data: {
            dnaRecordId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            exifData: (layers.metadata.data.exifData ?? undefined) as any,
            deviceMake: layers.metadata.data.deviceMake,
            deviceModel: layers.metadata.data.deviceModel,
            software: layers.metadata.data.software,
            capturedAt: layers.metadata.data.capturedAt,
            gpsLatitude: layers.metadata.data.gpsLatitude,
            gpsLongitude: layers.metadata.data.gpsLongitude,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            iptcData: (layers.metadata.data.iptcData ?? undefined) as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            xmpData: (layers.metadata.data.xmpData ?? undefined) as any,
            metadataHash: layers.metadata.data.metadataHash,
          },
        });
      }

      // ── Layer 6 ────────────────────────────────────────────────────────────
      if (layers.stego.success) {
        const ownership = layers.stego.data.ownershipSignature as
          | { dnaFingerprint?: string }
          | undefined;
        await tx.stegoLayer.create({
          data: {
            dnaRecordId,
            embedded: layers.stego.data.embedded,
            capacityBits: layers.stego.data.capacityBits,
            usedBits: layers.stego.data.usedBits,
            payloadHmac: layers.stego.data.payloadHmac,
            channel: layers.stego.data.channel,
            carrierPath: layers.stego.data.carrierPath,
            ownershipSignature: (layers.stego.data.ownershipSignature ?? undefined) as any,
            ownershipAlgorithm: layers.stego.data.ownershipAlgorithm ?? null,
            ownershipTileCount: layers.stego.data.ownershipTileCount ?? null,
            ownershipDnaFp: ownership?.dnaFingerprint ?? null,
          },
        });
      }

      // ── Layer 7 ────────────────────────────────────────────────────────────
      if (layers.behavioral.success) {
        await tx.behavioralLayer.create({
          data: {
            dnaRecordId,
            behaviorHash: layers.behavioral.data.behaviorHash,
            uploadMs:     layers.behavioral.data.uploadMs,
            sessionToken: layers.behavioral.data.sessionToken ?? null,
            userAgent:    layers.behavioral.data.userAgent,
            processingMs: layers.behavioral.processingMs,
          },
        });
      }

      // ── Layer 8 ────────────────────────────────────────────────────────────
      if (layers.relationship.success) {
        await tx.relationshipLayer.create({
          data: {
            dnaRecordId,
            graphHash:     layers.relationship.data.graphHash,
            relatedIds:    layers.relationship.data.relatedIds,
            relationTypes: layers.relationship.data.relationTypes,
            processingMs:  layers.relationship.processingMs,
          },
        });
      }

      // ── Layer 9 ────────────────────────────────────────────────────────────
      if (layers.origin.success) {
        await tx.originLayer.create({
          data: {
            dnaRecordId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            originBundle: layers.origin.data.originBundle as any,
            bundleHash:   layers.origin.data.bundleHash,
            processingMs: layers.origin.processingMs,
          },
        });
      }

      // ── Layer 10 ───────────────────────────────────────────────────────────
      if (layers.evolution.success) {
        await tx.evolutionLayer.create({
          data: {
            dnaRecordId,
            merkleRoot:   layers.evolution.data.merkleRoot,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mutationLog:  layers.evolution.data.mutationLog as any,
            version:      layers.evolution.data.version,
            processingMs: layers.evolution.processingMs,
          },
        });
      }

      // ── Update record status ───────────────────────────────────────────────
      await tx.dnaRecord.update({
        where: { id: dnaRecordId },
        data: { status: layers.status },
      });
    }, { timeout: 60_000, maxWait: 15_000 });
  }
}
