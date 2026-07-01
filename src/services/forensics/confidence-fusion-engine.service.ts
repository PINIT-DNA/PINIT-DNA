/**
 * Phase 6 — PINIT Original Identity Recovery confidence fusion.
 *
 * Separates three independent scores:
 * - Retrieval (did we find the original vault asset?)
 * - Identity recovery (watermark, token, manifest, OCR)
 * - Ownership verification (certificate, vault ownership proof)
 */
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type { VaultMatchResult } from './vault-auto-match.service';
import { pinitIdentificationConfig } from '../../config/pinit-identification';

export type ForensicVerdict =
  | 'ORIGINAL_VERIFIED'
  | 'ORIGINAL_FOUND_PARTIAL'
  | 'POSSIBLE_ASSET'
  | 'NO_SIGNATURE';

export const FORENSIC_VERDICT_LABELS: Record<ForensicVerdict, string> = {
  ORIGINAL_VERIFIED: 'Original PINIT Asset Verified',
  ORIGINAL_FOUND_PARTIAL: 'Original PINIT Asset Found (Partial Identity)',
  POSSIBLE_ASSET: 'Possible PINIT Asset',
  NO_SIGNATURE: 'No PINIT Signature Found',
};

export function classifyForensicVerdict(retrievalConfidence: number): ForensicVerdict {
  if (retrievalConfidence >= 90) return 'ORIGINAL_VERIFIED';
  if (retrievalConfidence >= 75) return 'ORIGINAL_FOUND_PARTIAL';
  if (retrievalConfidence >= 50) return 'POSSIBLE_ASSET';
  return 'NO_SIGNATURE';
}

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
  /** Legacy — maps to ownership verification score */
  ownershipConfidence: number;
  /** Patch DNA + ORB + local DNA + structural + pHash + 15-layer */
  retrievalConfidence: number;
  /** Watermark, identity token, manifest, OCR */
  identityConfidence: number;
  /** Certificate + vault ownership proof */
  ownershipVerificationConfidence: number;
  trustScore: number;
  highConfidence: boolean;
  forensicVerdict: ForensicVerdict;
  fusionMode: 'enterprise';
  breakdown: Array<{ label: string; score: number; weight: number; contribution: number }>;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeRetrievalConfidence(input: FusionInput): number {
  const dna15 = clamp(input.dna15LayerScore ?? 0);
  const patchVotes = input.patchVoteCount ?? 0;
  const geometric = clamp((input.geometricScore ?? 0) * 100);
  const localPatch = clamp(input.localPatchScore ?? 0);

  const orb = clamp(Math.max(
    input.localFeatureScore ?? 0,
    localPatch,
    input.candidate?.signals.some((s) =>
      s === 'local_features' || s.startsWith('opencv') || s === 'local_patch_dna' || s === 'dominant_vault_votes',
    ) ? input.candidate!.compositeScore : 0,
  ));

  const structural = clamp(Math.max(
    input.structuralScore ?? 0,
    input.candidate?.signals.includes('structural_fingerprint') ? input.candidate.compositeScore : 0,
  ));

  const perceptual = clamp(Math.max(
    input.perceptualHashScore ?? 0,
    input.visualDnaScore ?? 0,
    input.candidate?.signals.includes('perceptual_hash') ? input.candidate.compositeScore : 0,
  ));

  const vectorBoost = clamp(input.vaultVectorComposite ?? input.candidate?.compositeScore ?? 0);
  const peak = Math.max(dna15, orb, perceptual, structural, vectorBoost, localPatch, geometric);

  let retrieval = clamp(
    dna15 * 0.35
    + orb * 0.20
    + perceptual * 0.15
    + structural * 0.10
    + vectorBoost * 0.15
    + localPatch * 0.05,
  );

  if (input.sha256Score === 100) return 100;

  if (input.match) {
    if (dna15 >= 30 && vectorBoost >= 30) {
      retrieval = Math.max(retrieval, peak + 12);
    }
    if (dna15 >= 38 && (orb >= 30 || localPatch >= 35)) {
      retrieval = Math.max(retrieval, Math.min(89, peak + 15));
    }
    if (dna15 >= 40 && orb >= 40) {
      retrieval = Math.max(retrieval, Math.min(92, (dna15 + orb) / 2 + 8));
    }
  }

  if (patchVotes >= 25 && dna15 >= 35) retrieval = Math.max(retrieval, 78);
  if (patchVotes >= 50 && (orb >= 45 || dna15 >= 40)) retrieval = Math.max(retrieval, 85);
  if (patchVotes >= 80) retrieval = Math.max(retrieval, 90);
  if (patchVotes >= 200 && geometric >= 35) retrieval = Math.max(retrieval, 92);

  if (vectorBoost >= 85 && orb >= 55) retrieval = Math.max(retrieval, 93);
  else if (vectorBoost >= 72 && (orb >= 45 || perceptual >= 58)) retrieval = Math.max(retrieval, 86);
  else if (localPatch >= 65) retrieval = Math.max(retrieval, 90);
  else if (localPatch >= 50 && orb >= 40) retrieval = Math.max(retrieval, 80);

  if (dna15 >= 75 && orb >= 50) retrieval = Math.max(retrieval, 94);
  if (dna15 >= 55 && patchVotes >= 20) retrieval = Math.max(retrieval, 85);

  return clamp(retrieval);
}

function computeIdentityRecoveryConfidence(
  identityToken: number,
  watermark: number,
  dna15: number,
  orb: number,
  manifest: number,
  ocr: number,
): number {
  if (watermark > 0) {
    return clamp(identityToken * 0.35 + watermark * 0.30 + manifest * 0.15 + ocr * 0.10 + dna15 * 0.10);
  }
  return clamp(identityToken * 0.30 + manifest * 0.15 + ocr * 0.15 + dna15 * 0.20 + orb * 0.20);
}

function computeOwnershipVerificationConfidence(
  certificateScore: number,
  watermark: number,
  identityToken: number,
  manifest: number,
  hasMatch: boolean,
): number {
  return clamp(
    certificateScore * 0.45
    + (hasMatch ? 25 : 0)
    + watermark * 0.12
    + identityToken * 0.10
    + manifest * 0.08,
  );
}

export class ConfidenceFusionEngine {
  fuse(input: FusionInput): FusionResult {
    const identityToken = clamp(Math.max(input.identityTokenScore ?? 0, input.ocrScore ?? 0));
    const watermark = clamp(input.watermarkScore ?? 0);
    const manifest = clamp(input.manifestScore ?? 0);
    const certificateScore = clamp(input.certificateScore ?? 0);
    const dna15 = clamp(input.dna15LayerScore ?? 0);
    const localPatch = clamp(input.localPatchScore ?? 0);

    const orb = clamp(Math.max(
      input.localFeatureScore ?? 0,
      localPatch,
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

    const retrievalConfidence = computeRetrievalConfidence(input);

    const identityConfidence = computeIdentityRecoveryConfidence(
      identityToken, watermark, dna15, orb, manifest, clamp(input.ocrScore ?? 0),
    );

    const ownershipVerificationConfidence = computeOwnershipVerificationConfidence(
      certificateScore, watermark, identityToken, manifest, !!input.match,
    );

    const rows: FusionResult['breakdown'] = [
      { label: 'Retrieval (DNA + ORB + Patch)', score: retrievalConfidence, weight: 1, contribution: retrievalConfidence },
      { label: 'Identity Recovery', score: identityConfidence, weight: 1, contribution: identityConfidence },
      { label: 'Ownership Verification', score: ownershipVerificationConfidence, weight: 1, contribution: ownershipVerificationConfidence },
      { label: '15-Layer DNA Compare', score: dna15, weight: 0.35, contribution: dna15 * 0.35 },
      { label: 'ORB / Patch Votes', score: orb, weight: 0.20, contribution: orb * 0.20 },
      { label: 'Perceptual Hashes', score: perceptual, weight: 0.15, contribution: perceptual * 0.15 },
      { label: 'Invisible Watermark', score: watermark, weight: 0.12, contribution: watermark * 0.12 },
      { label: 'Identity Token', score: identityToken, weight: 0.10, contribution: identityToken * 0.10 },
      { label: 'Certificate', score: certificateScore, weight: 0.45, contribution: certificateScore * 0.45 },
      { label: 'CLIP / Semantic', score: clip, weight: 0.05, contribution: clip * 0.05 },
      { label: 'Structural Fingerprint', score: structural, weight: 0.10, contribution: structural * 0.10 },
    ];

    const forensicVerdict = classifyForensicVerdict(retrievalConfidence);

    const ownershipConfidence = ownershipVerificationConfidence;

    const trustScore = clamp(
      retrievalConfidence * 0.50
      + identityConfidence * 0.25
      + ownershipVerificationConfidence * 0.25,
    );

    const highConfidence = retrievalConfidence >= pinitIdentificationConfig.highConfidenceThreshold;

    return {
      ownershipConfidence,
      retrievalConfidence,
      identityConfidence,
      ownershipVerificationConfidence,
      trustScore,
      highConfidence,
      forensicVerdict,
      fusionMode: 'enterprise',
      breakdown: rows,
    };
  }
}

export const confidenceFusionEngine = new ConfidenceFusionEngine();
