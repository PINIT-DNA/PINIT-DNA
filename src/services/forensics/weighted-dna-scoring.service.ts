/**
 * Weighted multi-layer DNA verification scoring (enterprise v2.1).
 * Complements existing DnaVerifier — does not replace layer verify() methods.
 */
import type { LayerScoreInput, WeightedDnaScoreResult } from '../../types/dna-enhancements.types';
import { verifyCryptoEnhancements } from './crypto-enhancements';
import { verifyPerceptualEnhancements } from './perceptual-enhancements';
import { verifyMetadataEnhancements } from './metadata-enhancements';
import { verifySemanticEnhancements } from './semantic-enhancements';
import { verifyStructuralEnhancements } from './structural-enhancements';
import type { DnaEnhancementBundle } from '../../types/dna-enhancements.types';

const CORE_WEIGHTS: Record<string, number> = {
  cryptographic: 0.22,
  structural: 0.14,
  perceptual: 0.22,
  semantic: 0.12,
  metadata: 0.05,
  steganography: 0.10,
};

const ENHANCED_WEIGHTS: Record<string, number> = {
  crypto_extended: 0.05,
  perceptual_extended: 0.05,
  structural_extended: 0.03,
  semantic_extended: 0.02,
  metadata_extended: 0.02,
};

export class WeightedDnaScoringService {
  compute(
    coreLayerScores: LayerScoreInput[],
    probeEnhancements?: DnaEnhancementBundle,
    storedEnhancements?: DnaEnhancementBundle,
  ): WeightedDnaScoreResult {
    let weightedSum = 0;
    let weightTotal = 0;

    for (const ls of coreLayerScores) {
      const w = CORE_WEIGHTS[ls.layer] ?? 0;
      weightedSum += ls.score * w;
      weightTotal += w;
    }

    const enhancedLayerScores: LayerScoreInput[] = [];

    if (probeEnhancements && storedEnhancements) {
      if (probeEnhancements.crypto && storedEnhancements.crypto) {
        const score = verifyCryptoEnhancements(probeEnhancements.crypto, storedEnhancements.crypto);
        enhancedLayerScores.push({ layer: 'crypto_extended', score, weight: ENHANCED_WEIGHTS.crypto_extended!, passed: score >= 0.7 });
        weightedSum += score * ENHANCED_WEIGHTS.crypto_extended!;
        weightTotal += ENHANCED_WEIGHTS.crypto_extended!;
      }
      if (probeEnhancements.perceptual && storedEnhancements.perceptual) {
        const score = verifyPerceptualEnhancements(probeEnhancements.perceptual, storedEnhancements.perceptual);
        enhancedLayerScores.push({ layer: 'perceptual_extended', score, weight: ENHANCED_WEIGHTS.perceptual_extended!, passed: score >= 0.75 });
        weightedSum += score * ENHANCED_WEIGHTS.perceptual_extended!;
        weightTotal += ENHANCED_WEIGHTS.perceptual_extended!;
      }
      if (probeEnhancements.structural && storedEnhancements.structural) {
        const score = verifyStructuralEnhancements(probeEnhancements.structural, storedEnhancements.structural);
        enhancedLayerScores.push({ layer: 'structural_extended', score, weight: ENHANCED_WEIGHTS.structural_extended!, passed: score >= 0.7 });
        weightedSum += score * ENHANCED_WEIGHTS.structural_extended!;
        weightTotal += ENHANCED_WEIGHTS.structural_extended!;
      }
      if (probeEnhancements.semantic && storedEnhancements.semantic) {
        const score = verifySemanticEnhancements(probeEnhancements.semantic, storedEnhancements.semantic);
        enhancedLayerScores.push({ layer: 'semantic_extended', score, weight: ENHANCED_WEIGHTS.semantic_extended!, passed: score >= 0.65 });
        weightedSum += score * ENHANCED_WEIGHTS.semantic_extended!;
        weightTotal += ENHANCED_WEIGHTS.semantic_extended!;
      }
      if (probeEnhancements.metadata && storedEnhancements.metadata) {
        const score = verifyMetadataEnhancements(probeEnhancements.metadata, storedEnhancements.metadata);
        enhancedLayerScores.push({ layer: 'metadata_extended', score, weight: ENHANCED_WEIGHTS.metadata_extended!, passed: score >= 0.6 });
        weightedSum += score * ENHANCED_WEIGHTS.metadata_extended!;
        weightTotal += ENHANCED_WEIGHTS.metadata_extended!;
      }
    }

    const overallMatchScore = weightTotal > 0 ? weightedSum / weightTotal : 0;

    const crypto = coreLayerScores.find((l) => l.layer === 'cryptographic')?.score ?? 0;
    const perceptual = coreLayerScores.find((l) => l.layer === 'perceptual')?.score ?? 0;
    const stego = coreLayerScores.find((l) => l.layer === 'steganography')?.score ?? 0;

    const ownershipConfidence = Math.min(100, Math.round(
      overallMatchScore * 70 + stego * 20 + (crypto >= 1 ? 10 : 0),
    ));

    const tamperConfidence = Math.min(100, Math.round(
      (1 - crypto) * 40 + (1 - perceptual) * 30 + (1 - stego) * 30,
    ));

    return {
      overallMatchScore: Math.round(overallMatchScore * 1000) / 1000,
      ownershipConfidence,
      tamperConfidence,
      layerScores: coreLayerScores,
      enhancedLayerScores: enhancedLayerScores.length ? enhancedLayerScores : undefined,
    };
  }
}

export const weightedDnaScoringService = new WeightedDnaScoringService();
