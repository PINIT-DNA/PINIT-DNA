/**
 * PINIT-DNA — DNA Verifier
 *
 * Loads a stored DNA record and compares it against a freshly generated set
 * of fingerprints from a probe image. Each layer has its own similarity
 * threshold; the overall confidence score is a weighted average.
 *
 * Layer weights reflect how discriminative and tamper-sensitive each layer is:
 *   Layer 1 — Cryptographic  : 0.30 (binary, highest precision)
 *   Layer 2 — Structural     : 0.20
 *   Layer 3 — Perceptual     : 0.20
 *   Layer 4 — Semantic       : 0.15
 *   Layer 5 — Metadata       : 0.05 (often stripped; treated as bonus signal)
 *   Layer 6 — Steganography  : 0.10
 *
 * A record "passes" verification when:
 *   - confidenceScore >= PASS_THRESHOLD (default: 0.70)
 *   - Layer 1 OR Layer 3 individually passes (at least one strong signal)
 */

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

import { CryptographicLayer } from './layers/layer1.cryptographic';
import { StructuralLayer } from './layers/layer2.structural';
import { PerceptualLayer } from './layers/layer3.perceptual';
import { SemanticLayer } from './layers/layer4.semantic';
import { MetadataLayer } from './layers/layer5.metadata';
import { SteganographyLayer } from './layers/layer6.steganography';

import {
  ImageInput,
  DnaVerificationResult,
  LayerVerificationResult,
  LayerName,
} from '../types/dna.types';

// Minimum similarity score for each layer to be considered "passing"
const LAYER_THRESHOLDS: Record<LayerName, number> = {
  cryptographic: 1.0,   // exact match only
  structural: 0.75,
  perceptual: 0.80,
  semantic: 0.70,
  metadata: 0.60,
  steganography: 1.0,   // HMAC pass is binary
};

// Layer weights for confidence score calculation (must sum to 1.0)
const LAYER_WEIGHTS: Record<LayerName, number> = {
  cryptographic: 0.30,
  structural: 0.20,
  perceptual: 0.20,
  semantic: 0.15,
  metadata: 0.05,
  steganography: 0.10,
};

const PASS_THRESHOLD = 0.70;

export class DnaVerifier {
  private readonly layer1 = new CryptographicLayer();
  private readonly layer2 = new StructuralLayer();
  private readonly layer3 = new PerceptualLayer();
  private readonly layer4 = new SemanticLayer();
  private readonly layer5 = new MetadataLayer();
  private readonly layer6 = new SteganographyLayer();

  /**
   * Verify a probe image against an existing DNA record.
   *
   * @param dnaRecordId   - ID of the stored DNA record to compare against
   * @param probeImage    - The image being verified
   * @param layerFilter   - Optional: only verify specific layers
   */
  async verify(
    dnaRecordId: string,
    probeImage: ImageInput,
    layerFilter?: LayerName[]
  ): Promise<DnaVerificationResult> {
    logger.info('DNA verification started', { dnaRecordId, file: probeImage.originalName });

    // ── Load stored DNA record ────────────────────────────────────────────────
    const stored = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      include: {
        cryptoLayer: true,
        structuralLayer: true,
        perceptualLayer: true,
        semanticLayer: true,
        metadataLayer: true,
        stegoLayer: true,
      },
    });

    if (!stored) {
      throw new Error(`DNA record not found: ${dnaRecordId}`);
    }

    if (stored.status === 'FAILED') {
      throw new Error(`DNA record ${dnaRecordId} has status FAILED — cannot verify`);
    }

    // ── Generate probe fingerprints for requested layers ──────────────────────
    const layersToCheck: LayerName[] = layerFilter ?? [
      'cryptographic',
      'structural',
      'perceptual',
      'semantic',
      'metadata',
      'steganography',
    ];

    const layerResults: LayerVerificationResult[] = [];

    // ── Layer 1 ───────────────────────────────────────────────────────────────
    if (layersToCheck.includes('cryptographic') && stored.cryptoLayer) {
      const probe = await this.layer1.generate(probeImage);
      const score = this.layer1.verify(probe.data, stored.cryptoLayer);
      layerResults.push(this.buildLayerResult('cryptographic', score));
    }

    // ── Layer 2 ───────────────────────────────────────────────────────────────
    if (layersToCheck.includes('structural') && stored.structuralLayer) {
      const probe = await this.layer2.generate(probeImage);
      const score = this.layer2.verify(probe.data, stored.structuralLayer);
      layerResults.push(this.buildLayerResult('structural', score));
    }

    // ── Layer 3 ───────────────────────────────────────────────────────────────
    if (layersToCheck.includes('perceptual') && stored.perceptualLayer) {
      const probe = await this.layer3.generate(probeImage);
      const score = this.layer3.verify(probe.data, stored.perceptualLayer);
      layerResults.push(this.buildLayerResult('perceptual', score));
    }

    // ── Layer 4 ───────────────────────────────────────────────────────────────
    if (layersToCheck.includes('semantic') && stored.semanticLayer) {
      const probe = await this.layer4.generate(probeImage);
      const score = this.layer4.verify(probe.data, {
        histogramR: stored.semanticLayer.histogramR as number[],
        histogramG: stored.semanticLayer.histogramG as number[],
        histogramB: stored.semanticLayer.histogramB as number[],
        colorFingerprint: stored.semanticLayer.colorFingerprint,
      });
      layerResults.push(this.buildLayerResult('semantic', score));
    }

    // ── Layer 5 ───────────────────────────────────────────────────────────────
    if (layersToCheck.includes('metadata') && stored.metadataLayer) {
      const probe = await this.layer5.generate(probeImage);
      const score = this.layer5.verify(probe.data, {
        deviceMake: stored.metadataLayer.deviceMake,
        deviceModel: stored.metadataLayer.deviceModel,
        capturedAt: stored.metadataLayer.capturedAt,
        metadataHash: stored.metadataLayer.metadataHash,
      });
      layerResults.push(this.buildLayerResult('metadata', score));
    }

    // ── Layer 6 ───────────────────────────────────────────────────────────────
    if (layersToCheck.includes('steganography') && stored.stegoLayer) {
      const score = await this.layer6.verifyAsync(probeImage, {
        payloadHmac: stored.stegoLayer.payloadHmac,
        channel: stored.stegoLayer.channel,
        embedded: stored.stegoLayer.embedded,
      });
      layerResults.push(this.buildLayerResult('steganography', score));
    }

    // ── Compute weighted confidence score ─────────────────────────────────────
    const confidenceScore = this.computeConfidenceScore(layerResults);
    const passed = this.evaluatePassCriteria(layerResults, confidenceScore);

    // ── Persist verification log ──────────────────────────────────────────────
    const logEntry = await prisma.verificationLog.create({
      data: {
        dnaRecordId,
        passed,
        layerResults: layerResults as unknown as object,
        similarityScores: Object.fromEntries(
          layerResults.map((r) => [r.layer, r.similarityScore])
        ),
        confidenceScore,
        layersChecked: layersToCheck,
      },
    });

    logger.info('DNA verification complete', {
      dnaRecordId,
      passed,
      confidenceScore,
      verificationLogId: logEntry.id,
    });

    return {
      dnaRecordId,
      passed,
      confidenceScore,
      layerResults,
      layersChecked: layersToCheck,
      verifiedAt: new Date(),
      verificationLogId: logEntry.id,
    };
  }

  private buildLayerResult(
    layer: LayerName,
    similarityScore: number
  ): LayerVerificationResult {
    const threshold = LAYER_THRESHOLDS[layer];
    return {
      layer,
      passed: similarityScore >= threshold,
      similarityScore,
      threshold,
      detail: similarityScore >= threshold
        ? `Score ${similarityScore.toFixed(3)} meets threshold ${threshold}`
        : `Score ${similarityScore.toFixed(3)} below threshold ${threshold}`,
    };
  }

  private computeConfidenceScore(results: LayerVerificationResult[]): number {
    if (results.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const result of results) {
      const weight = LAYER_WEIGHTS[result.layer];
      weightedSum += result.similarityScore * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Evaluation criteria:
   * 1. Overall confidence must meet PASS_THRESHOLD
   * 2. At least one of: cryptographic OR perceptual layer must pass
   *    (prevents spoofing via metadata manipulation alone)
   */
  private evaluatePassCriteria(
    results: LayerVerificationResult[],
    confidenceScore: number
  ): boolean {
    if (confidenceScore < PASS_THRESHOLD) return false;

    const cryptoPassed = results.find((r) => r.layer === 'cryptographic')?.passed ?? false;
    const perceptualPassed = results.find((r) => r.layer === 'perceptual')?.passed ?? false;

    return cryptoPassed || perceptualPassed;
  }
}
