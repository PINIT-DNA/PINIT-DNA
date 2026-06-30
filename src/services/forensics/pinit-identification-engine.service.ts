/**
 * PINIT Identification Engine — backward-compatible facade.
 * Delegates to PINIT Original Identity Recovery Algorithm (7-stage enterprise pipeline).
 */
import { pinitOriginalIdentityRecoveryService } from './pinit-original-identity-recovery.service';
import type { DeepCompareResult } from './deep-vault-compare.service';
import type { FusionResult } from './confidence-fusion-engine.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';

export interface RecoveryStage {
  stage: string;
  status: 'complete' | 'partial' | 'failed' | 'skipped';
  detail: string;
}

export interface RecoveredIdentitySignal {
  stage: string;
  score: number;
  recovered: boolean;
  detail: string;
}

export interface PinitIdentificationResult {
  match: VaultMatchResult | null;
  probableMatch: VaultMatchResult | null;
  candidates: RankedVaultCandidate[];
  fusion: FusionResult;
  stages: RecoveryStage[];
  variantCount: number;
  manifestRecovered: boolean;
  identityTokenRecovered: boolean;
  watermarkRecovered: boolean;
  identified: boolean;
  highConfidence: boolean;
  recoveredSignals: RecoveredIdentitySignal[];
  deepCompareResults: DeepCompareResult[];
  certificateId: string | null;
  ownerShortId: string | null;
  tamperingSummary: string | null;
  bestDeepCompare: DeepCompareResult | null;
}

export class PinitIdentificationEngine {
  identify(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
  ): Promise<PinitIdentificationResult> {
    return pinitOriginalIdentityRecoveryService.recover(
      buffer, mimeType, originalName, sizeBytes, ownerUserId,
    );
  }
}

export const pinitIdentificationEngine = new PinitIdentificationEngine();
