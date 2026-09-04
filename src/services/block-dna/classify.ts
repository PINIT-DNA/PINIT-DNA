import { blockDnaConfig } from '../../config/block-dna';
import type { BlockDnaClassification } from '../../types/block-dna.types';

export interface ClassifyInput {
  dnaMatch: boolean;
  pixelSimilarity: number;
  meanAbsDiff: number;
  relocated: boolean;
  correspondingRegion: boolean;
  geometryUnsupported: boolean;
}

export function classifyBlock(input: ClassifyInput): BlockDnaClassification {
  if (input.geometryUnsupported || !input.correspondingRegion) return 'UNKNOWN';
  if (input.dnaMatch) return 'ORIGINAL';
  if (input.relocated) return 'MODIFIED';
  return 'MODIFIED';
}

export function applyJpegUnknownPolicy(
  statuses: BlockDnaClassification[],
  mads: number[],
  dnaMatches: boolean[],
): BlockDnaClassification[] {
  const n = statuses.length;
  if (n === 0) return statuses;
  let fails = 0;
  const failMads: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!dnaMatches[i]) {
      fails += 1;
      failMads.push(mads[i] ?? 255);
    }
  }
  const failRate = fails / n;
  if (failRate < blockDnaConfig.jpegUnknownFailRate) return statuses;
  failMads.sort((a, b) => a - b);
  const median = failMads[Math.floor(failMads.length / 2)] ?? 255;
  if (median > blockDnaConfig.jpegMedianMadMax) return statuses;
  return statuses.map((s, i) => {
    if (dnaMatches[i]) return s;
    if (s === 'MODIFIED') return 'UNKNOWN';
    return s;
  });
}

export function blockConfidence(dnaMatch: boolean, pixelSim: number, structural: number): number {
  if (dnaMatch) return Math.min(1, 0.7 + 0.3 * pixelSim);
  return Math.max(0, Math.min(1, 0.15 * pixelSim + 0.1 * structural));
}

export function buildNarrative(params: {
  originalPct: number;
  modifiedPct: number;
  unknownPct: number;
  available: boolean;
  authStatus: string;
}): string {
  if (!params.available) {
    return 'No authentic vault original was selected for block-level DNA verification.';
  }
  if (params.authStatus === 'NO_VAULT_MATCH') {
    return 'Vault retrieval confidence is too low to authenticate this upload. Unmatched regions are not treated as AI-generated.';
  }
  if (params.originalPct >= 50) {
    return 'Majority of the image matches the authenticated Vault content.';
  }
  if (params.unknownPct >= 50) {
    return 'Most blocks could not be cryptographically authenticated (crop, resize, compression, or missing correspondence).';
  }
  return 'Block-level DNA verification found authenticated, modified, and/or unknown regions on this upload.';
}
