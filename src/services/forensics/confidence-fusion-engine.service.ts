/**
 * Enterprise confidence fusion — weighted ownership score from all recovery signals.
 */
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type { VaultMatchResult } from './vault-auto-match.service';

export interface FusionInput {
  watermarkScore?: number;
  identityTokenScore?: number;
  manifestScore?: number;
  certificateScore?: number;
  sha256Score?: number;
  visualDnaScore?: number;
  perceptualHashScore?: number;
  structuralScore?: number;
  semanticScore?: number;
  textureScore?: number;
  ocrScore?: number;
  metadataScore?: number;
  candidate?: RankedVaultCandidate | null;
  match?: VaultMatchResult | null;
}

export interface FusionResult {
  ownershipConfidence: number;
  identityConfidence: number;
  trustScore: number;
  breakdown: Array<{ label: string; score: number; weight: number; contribution: number }>;
}

const FUSION_WEIGHTS = {
  invisibleWatermark: 0.22,
  identityToken: 0.18,
  manifest: 0.10,
  certificate: 0.05,
  sha256: 0.10,
  visualDna: 0.12,
  perceptualHash: 0.08,
  structural: 0.05,
  semantic: 0.05,
  texture: 0.03,
  ocr: 0.02,
} as const;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export class ConfidenceFusionEngine {
  fuse(input: FusionInput): FusionResult {
    const candidateScore = input.candidate?.compositeScore ?? 0;
    const matchBoost = input.match
      ? input.match.tier === 1
        ? 100
        : input.match.tier === 2
          ? 88
          : input.match.visualSimilarity
            ? Math.round(input.match.visualSimilarity * 100)
            : 70
      : 0;

    const visual = Math.max(input.visualDnaScore ?? 0, input.perceptualHashScore ?? 0, candidateScore, matchBoost);
    const structural = input.structuralScore ?? (candidateScore > 0 ? candidateScore * 0.85 : 0);
    const texture = input.textureScore ?? (visual > 0 ? visual * 0.9 : 0);

    const rows: FusionResult['breakdown'] = [
      { label: 'Invisible Watermark', score: clamp(input.watermarkScore ?? 0), weight: FUSION_WEIGHTS.invisibleWatermark, contribution: 0 },
      { label: 'Identity Token', score: clamp(input.identityTokenScore ?? 0), weight: FUSION_WEIGHTS.identityToken, contribution: 0 },
      { label: 'Integrity Manifest', score: clamp(input.manifestScore ?? 0), weight: FUSION_WEIGHTS.manifest, contribution: 0 },
      { label: 'Certificate', score: clamp(input.certificateScore ?? 0), weight: FUSION_WEIGHTS.certificate, contribution: 0 },
      { label: 'SHA-256', score: clamp(input.sha256Score ?? 0), weight: FUSION_WEIGHTS.sha256, contribution: 0 },
      { label: 'Visual DNA', score: clamp(visual), weight: FUSION_WEIGHTS.visualDna, contribution: 0 },
      { label: 'Perceptual Hash', score: clamp(input.perceptualHashScore ?? visual), weight: FUSION_WEIGHTS.perceptualHash, contribution: 0 },
      { label: 'Structural', score: clamp(structural), weight: FUSION_WEIGHTS.structural, contribution: 0 },
      { label: 'Semantic', score: clamp(input.semanticScore ?? 0), weight: FUSION_WEIGHTS.semantic, contribution: 0 },
      { label: 'Texture', score: clamp(texture), weight: FUSION_WEIGHTS.texture, contribution: 0 },
      { label: 'OCR Signals', score: clamp(input.ocrScore ?? 0), weight: FUSION_WEIGHTS.ocr, contribution: 0 },
    ];

    let weighted = 0;
    for (const row of rows) {
      row.contribution = Math.round(row.score * row.weight * 100) / 100;
      weighted += row.contribution;
    }

    const ownershipConfidence = clamp(weighted);
    const identityConfidence = clamp(
      (input.identityTokenScore ?? 0) * 0.35
      + (input.manifestScore ?? 0) * 0.25
      + (input.watermarkScore ?? 0) * 0.25
      + visual * 0.15,
    );
    const trustScore = clamp(
      ownershipConfidence * 0.45
      + identityConfidence * 0.35
      + (input.certificateScore ?? 0) * 0.1
      + (input.metadataScore ?? 0) * 0.1,
    );

    return { ownershipConfidence, identityConfidence, trustScore, breakdown: rows };
  }
}

export const confidenceFusionEngine = new ConfidenceFusionEngine();
