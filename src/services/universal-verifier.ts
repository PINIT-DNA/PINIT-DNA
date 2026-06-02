/**
 * PINIT-DNA — Universal Verifier
 *
 * Verifies non-image DNA records (TXT, CSV, JSON and future types).
 *
 * Strategy per layer:
 *   L1 — Cryptographic : exact SHA-256 match → 1.0, else 0.0
 *   L2 — Structural    : compare fingerprint SHA-256 strings exactly
 *   L3 — Perceptual    : SimHash Hamming-distance similarity
 *   L4 — Semantic      : fingerprint string comparison
 *   L5 — Metadata      : fingerprint string comparison
 *   L6 — Signature     : HMAC string comparison (exact)
 *
 * Layer weights (same philosophy as image verifier):
 *   L1 0.35 · L2 0.20 · L3 0.20 · L4 0.10 · L5 0.05 · L6 0.10
 *
 * Pass criteria: confidenceScore >= 0.70 AND L1 OR L3 passes individually.
 */

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { FileInput } from './universal-file-router';
import { TxtDnaEngine }  from './engines/txt/txt-dna-engine';
import { CsvDnaEngine }  from './engines/csv/csv-dna-engine';
import { JsonDnaEngine } from './engines/json/json-dna-engine';
import { PdfDnaEngine }   from './engines/pdf/pdf-dna-engine';
import { DocxDnaEngine }  from './engines/docx/docx-dna-engine';
import { PptxDnaEngine }  from './engines/pptx/pptx-dna-engine';
import { ZipDnaEngine }   from './engines/zip/zip-dna-engine';
import { VideoDnaEngine } from './engines/video/video-dna-engine';
import { AudioDnaEngine } from './engines/audio/audio-dna-engine';
import { hammingDistance } from './engines/base/text-utils';
import {
  UniversalLayerResult,
  UniversalLayerVerification,
  UniversalVerificationResult,
} from '../types/universal-engine.types';
import { computeHmac } from './engines/base/text-utils';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

// ─── Weights and thresholds ───────────────────────────────────────────────────

const LAYER_WEIGHTS  = [0.35, 0.20, 0.20, 0.10, 0.05, 0.10]; // L1–L6
const LAYER_THRESHOLDS = [1.0, 0.80, 0.75, 0.70, 0.60, 1.0]; // L1–L6
const PASS_THRESHOLD = 0.70;
const SIMHASH_BITS   = 64; // must match txt-dna-engine L3

// ─── Verifier ─────────────────────────────────────────────────────────────────

export class UniversalVerifier {
  /**
   * Verify a probe file against a stored universal DNA record.
   *
   * @param dnaRecordId  - ID of the stored DNA record
   * @param probeFile    - The file being verified (re-generates fingerprints)
   */
  async verify(
    dnaRecordId: string,
    probeFile: FileInput
  ): Promise<UniversalVerificationResult> {
    logger.info('Universal verification started', {
      dnaRecordId, file: probeFile.originalName,
    });

    // ── Load stored record ────────────────────────────────────────────────────
    const stored = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { id: true, fileType: true, status: true, universalFingerprints: true },
    });

    if (!stored) throw new Error(`DNA record not found: ${dnaRecordId}`);
    if (stored.status === 'FAILED') {
      throw new Error(`DNA record ${dnaRecordId} has status FAILED — cannot verify`);
    }
    if (!stored.universalFingerprints) {
      throw new Error(`DNA record ${dnaRecordId} has no universal fingerprints stored`);
    }

    const storedData = stored.universalFingerprints as unknown as { layers: UniversalLayerResult[] };
    const storedLayers = storedData.layers;
    const fileType = stored.fileType ?? 'TXT';

    // ── Re-generate fingerprints for the probe file ───────────────────────────
    const tempId = uuidv4();
    let probeLayers: UniversalLayerResult[];

    try {
      // Create a temporary DB record for the probe (status=PROCESSING, deleted after)
      await prisma.dnaRecord.create({
        data: {
          id: tempId,
          imageFilename: probeFile.originalName,
          imageMimeType: probeFile.declaredMimeType,
          imageSizeBytes: probeFile.sizeBytes,
          schemaVersion: '1.0.0',
          status: 'PROCESSING',
          fileType,
          engineVersion: '2.0.0-universal',
        },
      });

      const probeResult = await this.runEngine(fileType, probeFile, tempId);
      probeLayers = probeResult;

      // ── Fix L6: recompute HMAC using the ORIGINAL dnaRecordId ─────────────
      // The engine computed HMAC with tempId; verification must compare
      // against the original ID's HMAC. Recompute from probe L1-L5 fingerprints.
      const l1to5 = probeLayers.slice(0, 5).filter(l => l.success).map(l => l.fingerprint).join('|');
      const correctHmac = computeHmac(`${fileType}:${dnaRecordId}:${l1to5}`, config.stego.signatureSecret);
      if (probeLayers[5]) {
        probeLayers[5] = { ...probeLayers[5], fingerprint: correctHmac };
      }
    } finally {
      // Clean up the temp record — we only needed it for the engine's DB write
      await prisma.dnaRecord.delete({ where: { id: tempId } }).catch(() => {/* ignore */});
    }

    // ── Compare layer by layer ────────────────────────────────────────────────
    const layerResults: UniversalLayerVerification[] = [];

    for (let i = 0; i < 6; i++) {
      const stored = storedLayers[i];
      const probe  = probeLayers[i];

      if (!stored || !probe) {
        layerResults.push({
          layer: i + 1, name: `layer${i + 1}`,
          passed: false, similarityScore: 0,
          threshold: LAYER_THRESHOLDS[i],
          detail: 'Layer data missing',
        });
        continue;
      }

      const score = this.compareLayer(i + 1, stored, probe);
      layerResults.push({
        layer: i + 1,
        name: stored.name,
        passed: score >= LAYER_THRESHOLDS[i],
        similarityScore: score,
        threshold: LAYER_THRESHOLDS[i],
        detail: score >= LAYER_THRESHOLDS[i]
          ? `Score ${score.toFixed(3)} meets threshold ${LAYER_THRESHOLDS[i]}`
          : `Score ${score.toFixed(3)} below threshold ${LAYER_THRESHOLDS[i]}`,
      });
    }

    // ── Compute confidence score ──────────────────────────────────────────────
    const confidenceScore = layerResults.reduce(
      (sum, r, i) => sum + r.similarityScore * LAYER_WEIGHTS[i], 0
    );

    const l1Passed = layerResults[0]?.passed ?? false;
    const l3Passed = layerResults[2]?.passed ?? false;
    const passed   = confidenceScore >= PASS_THRESHOLD && (l1Passed || l3Passed);

    // ── Persist verification log ──────────────────────────────────────────────
    const logEntry = await prisma.verificationLog.create({
      data: {
        dnaRecordId,
        passed,
        layerResults: layerResults as unknown as object,
        similarityScores: Object.fromEntries(
          layerResults.map((r) => [r.name, r.similarityScore])
        ),
        confidenceScore,
        layersChecked: layerResults.map(r => r.name),
      },
    });

    logger.info('Universal verification complete', {
      dnaRecordId, passed, confidenceScore, fileType,
    });

    return {
      dnaRecordId, fileType: stored.fileType ?? 'UNKNOWN',
      passed, confidenceScore, layerResults,
      verifiedAt: new Date(), verificationLogId: logEntry.id,
    };
  }

  // ─── Layer comparison ─────────────────────────────────────────────────────

  private compareLayer(
    layerNum: number,
    stored: UniversalLayerResult,
    probe: UniversalLayerResult
  ): number {
    if (!stored.success || !probe.success) return 0;

    // L1 (Cryptographic) and L6 (Signature): exact binary match
    if (layerNum === 1 || layerNum === 6) {
      return stored.fingerprint === probe.fingerprint ? 1.0 : 0.0;
    }

    // L3 (Perceptual): SimHash Hamming distance
    if (layerNum === 3) {
      return this.simHashSimilarity(stored.fingerprint, probe.fingerprint);
    }

    // L2, L4, L5: fingerprint comparison (structural hashes)
    // Use Hamming on the hex hash for partial-match scoring
    return this.hexSimilarity(stored.fingerprint, probe.fingerprint);
  }

  private simHashSimilarity(a: string, b: string): number {
    if (a.length !== b.length) return 0;
    const dist = hammingDistance(a, b);
    return Math.max(0, 1 - dist / SIMHASH_BITS);
  }

  private hexSimilarity(a: string, b: string): number {
    // Exact match → 1.0
    if (a === b) return 1.0;
    // No partial credit for structural/semantic hashes (they're whole-document)
    return 0.0;
  }

  // ─── Engine dispatcher ────────────────────────────────────────────────────

  private async runEngine(
    fileType: string,
    file: FileInput,
    tempId: string
  ): Promise<UniversalLayerResult[]> {
    switch (fileType) {
      case 'TXT': {
        const engine = new TxtDnaEngine();
        const result = await engine.generate(file, tempId);
        return result.layers;
      }
      case 'CSV': {
        const engine = new CsvDnaEngine();
        const result = await engine.generate(file, tempId);
        return result.layers;
      }
      case 'JSON': {
        const engine = new JsonDnaEngine();
        const result = await engine.generate(file, tempId);
        return result.layers;
      }
      case 'IMAGE': {
        // IMAGE: DnaOrchestrator creates its own UUID — capture it
        const imageInput = {
          filePath: file.filePath, originalName: file.originalName,
          mimeType: file.declaredMimeType, sizeBytes: file.sizeBytes, buffer: file.buffer,
        };
        const orcResult = await new (await import('./dna.orchestrator')).DnaOrchestrator()
          .generate(imageInput, { fileType: 'IMAGE', engineVersion: '2.0.0-universal' });
        // Overwrite tempId so cleanup targets the right record
        await prisma.dnaRecord.delete({ where: { id: tempId } }).catch(() => {});
        // Re-read from the orchestrator's actual ID — but we need layers from image tables
        // For now, re-use the returned dnaRecordId via a direct query
        const rec = await prisma.dnaRecord.findUnique({
          where: { id: orcResult.dnaRecordId },
          include: { cryptoLayer: true, structuralLayer: true, perceptualLayer: true,
            semanticLayer: true, metadataLayer: true, stegoLayer: true },
        });
        const layers: UniversalLayerResult[] = [
          rec?.cryptoLayer ? { layer: 1, name: 'cryptographic', implementation: 'sha256', fingerprint: rec.cryptoLayer.sha256Hash, data: {}, success: true, processingMs: 0 } : null,
          rec?.structuralLayer ? { layer: 2, name: 'structural', implementation: 'sobel', fingerprint: rec.structuralLayer.edgeSignature64, data: {}, success: true, processingMs: 0 } : null,
          rec?.perceptualLayer ? { layer: 3, name: 'perceptual', implementation: 'phash', fingerprint: rec.perceptualLayer.pHash64, data: {}, success: true, processingMs: 0 } : null,
          rec?.semanticLayer ? { layer: 4, name: 'semantic', implementation: 'histogram', fingerprint: rec.semanticLayer.colorFingerprint, data: {}, success: true, processingMs: 0 } : null,
          rec?.metadataLayer ? { layer: 5, name: 'metadata', implementation: 'exif', fingerprint: rec.metadataLayer.metadataHash, data: {}, success: true, processingMs: 0 } : null,
          rec?.stegoLayer ? { layer: 6, name: 'signature', implementation: 'lsb', fingerprint: rec.stegoLayer.payloadHmac, data: {}, success: true, processingMs: 0 } : null,
        ].filter(Boolean) as UniversalLayerResult[];
        await prisma.dnaRecord.delete({ where: { id: orcResult.dnaRecordId } }).catch(() => {});
        return layers;
      }
      case 'PDF': {
        const engine = new PdfDnaEngine();
        const result = await engine.generate(file, tempId);
        return result.layers;
      }
      case 'DOCX': {
        const engine = new DocxDnaEngine();
        const result = await engine.generate(file, tempId);
        return result.layers;
      }
      case 'PPTX': {
        const engine = new PptxDnaEngine();
        const result = await engine.generate(file, tempId);
        return result.layers;
      }
      case 'ZIP': {
        const engine = new ZipDnaEngine();
        const result = await engine.generate(file, tempId);
        return result.layers;
      }
      case 'VIDEO': {
        const engine = new VideoDnaEngine();
        const result = await engine.generate(file, tempId);
        return result.layers;
      }
      case 'AUDIO': {
        const engine = new AudioDnaEngine();
        const result = await engine.generate(file, tempId);
        return result.layers;
      }
      default:
        throw new Error(`Universal verifier: no engine for file type "${fileType}"`);
    }
  }
}
