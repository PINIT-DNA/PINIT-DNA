/**
 * Structured investigation score logging — every stage for crop/compress debug.
 * Grep: [InvestigationScores]
 */
import { logger } from '../../lib/logger';

export type InvestigationScoreStage =
  | 'fusion'
  | 'ranking'
  | 'acceptance'
  | 'dna_compare'
  | 'post_dna_accept'
  | 'partial_report'
  | 'watermark'
  | 'visual_vector';

export interface InvestigationScorePayload {
  stage: InvestigationScoreStage;
  investigationId?: string;
  vaultId?: string | null;
  dnaRecordId?: string | null;
  fingerprint?: {
    overall?: number;
    classification?: string;
    layers?: Array<{ layer: number | string; percent: number; matched?: boolean }>;
  };
  watermark?: { score?: number; recovered?: boolean; method?: string };
  visual?: {
    orb?: number;
    perceptual?: number;
    pHash?: number;
    structural?: number;
    clip?: number;
    composite?: number;
    localPatch?: number;
  };
  fusion?: {
    retrieval?: number;
    identity?: number;
    ownershipVerification?: number;
    forensicVerdict?: string;
  };
  acceptance?: {
    verdict?: string;
    confidence?: number;
    dna?: number;
    visual?: number;
    certificate?: number;
    watermark?: number;
    vault?: number;
    owner?: number;
    reason?: string;
  };
  extra?: Record<string, unknown>;
}

export function logInvestigationScores(payload: InvestigationScorePayload): void {
  logger.info('[InvestigationScores]', {
    ...payload,
    vaultId: payload.vaultId ? String(payload.vaultId).slice(0, 8) : null,
    dnaRecordId: payload.dnaRecordId ? String(payload.dnaRecordId).slice(0, 8) : null,
  });
}
