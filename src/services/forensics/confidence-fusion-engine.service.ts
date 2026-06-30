/**
 * Phase 6 — PINIT Original Identity Recovery confidence fusion.
 *
 * Identity token .......... 30%
 * Invisible watermark ..... 25%
 * 15-layer DNA compare .... 20%
 * ORB ..................... 10%
 * CLIP ....................... 5%
 * Structural fingerprint ..... 5%
 * Perceptual hashes .......... 5%
 */
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type { VaultMatchResult } from './vault-auto-match.service';
import { pinitIdentificationConfig } from '../../config/pinit-identification';

export interface FusionInput {
  watermarkScore?: number;
  identityTokenScore?: number;
  manifestScore?: number;
  certificateScore?: number;
  sha256Score?: number;
  dna15LayerScore?: number;
  visualDnaScore?: number;
  perceptualHashScore?: number;
  structuralScore?: number;
  semanticScore?: number;
  localFeatureScore?: number;
  localPatchScore?: number;
  textureScore?: number;
  ocrScore?: number;
  metadataScore?: number;
  candidate?: RankedVaultCandidate | null;
  match?: VaultMatchResult | null;
  vaultVectorComposite?: number;
}

export interface FusionResult {
  ownershipConfidence: number;
  identityConfidence: number;
  trustScore: number;
  highConfidence: boolean;
  fusionMode: 'enterprise';
  breakdown: Array<{ label: string; score: number; weight: number; contribution: number }>;
}

const ENTERPRISE_WEIGHTS = {
  identityToken: 0.30,
  invisibleWatermark: 0.25,
  dna15Layer: 0.20,
  orb: 0.10,
  clip: 0.05,
  structural: 0.05,
  perceptual: 0.05,
} as const;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export class ConfidenceFusionEngine {
  fuse(input: FusionInput): FusionResult {
    const identityToken = clamp(Math.max(input.identityTokenScore ?? 0, input.ocrScore ?? 0));
    const watermark = clamp(input.watermarkScore ?? 0);
    const dna15 = clamp(input.dna15LayerScore ?? 0);
    const orb = clamp(Math.max(
      input.localFeatureScore ?? 0,
      input.localPatchScore ?? 0,
      input.candidate?.signals.some((s) => s === 'local_features' || s.startsWith('opencv') || s === 'local_patch_dna') ? input.candidate.compositeScore : 0,
    ));
    const clip = clamp(input.semanticScore ?? 0);
    const structural = clamp(Math.max(
      input.structuralScore ?? 0,
      input.candidate?.signals.includes('structural_fingerprint') ? input.candidate.compositeScore : 0,
    ));
    const perceptual = clamp(Math.max(
      input.perceptualHashScore ?? 0,
      input.visualDnaScore ?? 0,
      input.candidate?.signals.includes('perceptual_hash') ? input.candidate.compositeScore : 0,
    ));

    const rows: FusionResult['breakdown'] = [
      { label: 'Identity Token', score: identityToken, weight: ENTERPRISE_WEIGHTS.identityToken, contribution: 0 },
      { label: 'Invisible Watermark', score: watermark, weight: ENTERPRISE_WEIGHTS.invisibleWatermark, contribution: 0 },
      { label: '15-Layer DNA Compare', score: dna15, weight: ENTERPRISE_WEIGHTS.dna15Layer, contribution: 0 },
      { label: 'ORB / Local Features', score: orb, weight: ENTERPRISE_WEIGHTS.orb, contribution: 0 },
      { label: 'CLIP / Semantic', score: clip, weight: ENTERPRISE_WEIGHTS.clip, contribution: 0 },
      { label: 'Structural Fingerprint', score: structural, weight: ENTERPRISE_WEIGHTS.structural, contribution: 0 },
      { label: 'Perceptual Hashes', score: perceptual, weight: ENTERPRISE_WEIGHTS.perceptual, contribution: 0 },
    ];

    let weighted = 0;
    for (const row of rows) {
      row.contribution = Math.round(row.score * row.weight * 100) / 100;
      weighted += row.contribution;
    }

    // Vault-vector composite reinforces visual identification when identity signals are stripped
    const vectorBoost = input.vaultVectorComposite ?? input.candidate?.compositeScore ?? 0;
    let ownershipConfidence = clamp(weighted);

    if (vectorBoost >= 85 && orb >= 70) {
      ownershipConfidence = Math.max(ownershipConfidence, 93);
    } else if (vectorBoost >= 78 && (orb >= 55 || perceptual >= 65)) {
      ownershipConfidence = Math.max(ownershipConfidence, 88);
    } else if ((input.localPatchScore ?? 0) >= 72) {
      ownershipConfidence = Math.max(ownershipConfidence, 90);
    } else if ((input.localPatchScore ?? 0) >= 55 && orb >= 45) {
      ownershipConfidence = Math.max(ownershipConfidence, 82);
    }

    if (input.sha256Score === 100) ownershipConfidence = 100;
    if (identityToken >= 90 && watermark >= 70) {
      ownershipConfidence = Math.max(ownershipConfidence, 96);
    }

    const identityConfidence = clamp(
      identityToken * 0.40 + watermark * 0.30 + dna15 * 0.20 + perceptual * 0.10,
    );

    const trustScore = clamp(
      ownershipConfidence * 0.55 + identityConfidence * 0.30 + (input.certificateScore ?? 0) * 0.15,
    );

    const highConfidence = ownershipConfidence >= pinitIdentificationConfig.highConfidenceThreshold;

    return {
      ownershipConfidence,
      identityConfidence,
      trustScore,
      highConfidence,
      fusionMode: 'enterprise',
      breakdown: rows,
    };
  }
}

export const confidenceFusionEngine = new ConfidenceFusionEngine();
