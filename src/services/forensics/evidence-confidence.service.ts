/**
 * Phase 2 — Evidence Confidence Engine for investigation reports.
 */
import type {
  EvidenceConfidenceResult,
  LayerScoreInput,
  TamperVector,
} from '../../types/dna-enhancements.types';
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';

export class EvidenceConfidenceService {
  compute(
    overallMatch: number,
    layerScores: LayerScoreInput[],
    tamperVector?: TamperVector,
    hasCertificate?: boolean,
    identityScore?: number,
  ): EvidenceConfidenceResult | undefined {
    if (!isPhase2Active() || !dnaPhase2.evidenceConfidence) return undefined;

    const crypto = layerScores.find((l) => l.layer === 'cryptographic')?.score ?? 0;
    const stego = layerScores.find((l) => l.layer === 'steganography')?.score ?? 0;
    const perceptual = layerScores.find((l) => l.layer === 'perceptual')?.score ?? 0;
    const ocr = layerScores.find((l) => l.layer === 'ocr')?.score ?? 0;

    const ownershipScore = Math.min(100, Math.round(overallMatch * 60 + stego * 25 + (crypto >= 1 ? 15 : 0)));
    const evidenceScore = Math.min(100, Math.round(perceptual * 35 + ocr * 25 + overallMatch * 40));
    const identityScoreVal = Math.min(100, Math.round((identityScore ?? stego) * 100));
    const tamperScore = this.tamperScore(tamperVector, crypto, perceptual);
    const certificateScore = hasCertificate ? 85 : 40;
    const trustScore = Math.min(100, Math.round(
      ownershipScore * 0.3 + evidenceScore * 0.25 + identityScoreVal * 0.2
      + certificateScore * 0.15 + (100 - tamperScore) * 0.1,
    ));
    const legalConfidence = Math.min(100, Math.round(
      trustScore * 0.6 + certificateScore * 0.25 + (100 - tamperScore) * 0.15,
    ));

    return {
      ownershipScore,
      evidenceScore,
      identityScore: identityScoreVal,
      tamperScore,
      certificateScore,
      trustScore,
      legalConfidence,
    };
  }

  private tamperScore(vector: TamperVector | undefined, crypto: number, perceptual: number): number {
    if (!vector || vector === 'NONE' || vector === 'EXACT_COPY') return Math.round((1 - crypto) * 20);
    const severity: Partial<Record<TamperVector, number>> = {
      METADATA_REMOVAL: 25,
      COMPRESSION: 35,
      CROP: 45,
      SCREENSHOT: 55,
      SCREEN_RECORDING: 60,
      WATERMARK_REMOVAL: 70,
      AI_EDITING: 65,
      AI_UPSCALE: 50,
      PARTIAL_CLIP: 55,
      OCR_MODIFICATION: 40,
    };
    const base = severity[vector] ?? 50;
    return Math.min(100, Math.round(base + (1 - perceptual) * 30));
  }
}

export const evidenceConfidenceService = new EvidenceConfidenceService();
