/**
 * Phase 6 — PINIT Original Identity Recovery confidence fusion.
 *
 * Evidence-based scoring — missing watermark must NOT collapse confidence.
 * Retrieval signals (patch votes, ORB, 15-layer) compensate when watermark=0.
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
  patchVoteCount?: number;
  geometricScore?: number;
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

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export class ConfidenceFusionEngine {
  fuse(input: FusionInput): FusionResult {
    const identityToken = clamp(Math.max(input.identityTokenScore ?? 0, input.ocrScore ?? 0));
    const watermark = clamp(input.watermarkScore ?? 0);
    const dna15 = clamp(input.dna15LayerScore ?? 0);
    const patchVotes = input.patchVoteCount ?? 0;
    const geometric = clamp((input.geometricScore ?? 0) * 100);

    const orb = clamp(Math.max(
      input.localFeatureScore ?? 0,
      input.localPatchScore ?? 0,
      input.candidate?.signals.some((s) =>
        s === 'local_features' || s.startsWith('opencv') || s === 'local_patch_dna' || s === 'dominant_vault_votes',
      ) ? input.candidate!.compositeScore : 0,
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

    // Redistribute watermark weight when absent — retrieval must still score high
    const wmWeight = watermark > 0 ? 0.25 : 0;
    const redistributed = watermark > 0 ? 0 : 0.25;
    const orbWeight = 0.10 + redistributed * 0.40;
    const dnaWeight = 0.20 + redistributed * 0.35;
    const perceptualWeight = 0.05 + redistributed * 0.25;

    const rows: FusionResult['breakdown'] = [
      { label: 'Identity Token', score: identityToken, weight: 0.30, contribution: 0 },
      { label: 'Invisible Watermark', score: watermark, weight: wmWeight, contribution: 0 },
      { label: '15-Layer DNA Compare', score: dna15, weight: dnaWeight, contribution: 0 },
      { label: 'ORB / Patch Votes', score: orb, weight: orbWeight, contribution: 0 },
      { label: 'CLIP / Semantic', score: clip, weight: 0.05, contribution: 0 },
      { label: 'Structural Fingerprint', score: structural, weight: 0.05, contribution: 0 },
      { label: 'Perceptual Hashes', score: perceptual, weight: perceptualWeight, contribution: 0 },
    ];

    let weighted = 0;
    for (const row of rows) {
      row.contribution = Math.round(row.score * row.weight * 100) / 100;
      weighted += row.contribution;
    }

    const vectorBoost = input.vaultVectorComposite ?? input.candidate?.compositeScore ?? 0;
    let ownershipConfidence = clamp(weighted);

    // Evidence score boosts — patch voting dominates when watermark missing
    if (patchVotes >= 80 && (orb >= 45 || dna15 >= 40)) {
      ownershipConfidence = Math.max(ownershipConfidence, 92);
    } else if (patchVotes >= 40 && geometric >= 50) {
      ownershipConfidence = Math.max(ownershipConfidence, 88);
    } else if (patchVotes >= 25 && dna15 >= 42) {
      ownershipConfidence = Math.max(ownershipConfidence, 82);
    }

    if (vectorBoost >= 85 && orb >= 55) {
      ownershipConfidence = Math.max(ownershipConfidence, 93);
    } else if (vectorBoost >= 72 && (orb >= 45 || perceptual >= 58)) {
      ownershipConfidence = Math.max(ownershipConfidence, 86);
    } else if ((input.localPatchScore ?? 0) >= 65) {
      ownershipConfidence = Math.max(ownershipConfidence, 90);
    } else if ((input.localPatchScore ?? 0) >= 50 && orb >= 40) {
      ownershipConfidence = Math.max(ownershipConfidence, 80);
    }

    if (input.sha256Score === 100) ownershipConfidence = 100;
    if (identityToken >= 90 && watermark >= 70) {
      ownershipConfidence = Math.max(ownershipConfidence, 96);
    }
    if (dna15 >= 75 && orb >= 50) {
      ownershipConfidence = Math.max(ownershipConfidence, 94);
    }
    if (dna15 >= 55 && patchVotes >= 20) {
      ownershipConfidence = Math.max(ownershipConfidence, 85);
    }
    if (patchVotes >= 100 && (input.localPatchScore ?? 0) >= 40) {
      ownershipConfidence = Math.max(ownershipConfidence, 88);
    }
    if (patchVotes >= 200 && geometric >= 35) {
      ownershipConfidence = Math.max(ownershipConfidence, 92);
    }
    if (patchVotes >= 400) {
      ownershipConfidence = Math.max(ownershipConfidence, 94);
    }

    const identityConfidence = watermark > 0
      ? clamp(identityToken * 0.40 + watermark * 0.30 + dna15 * 0.20 + perceptual * 0.10)
      : clamp(identityToken * 0.30 + dna15 * 0.30 + orb * 0.25 + perceptual * 0.15);

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
