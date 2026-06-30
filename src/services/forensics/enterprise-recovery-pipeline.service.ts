/**
 * Enterprise multi-stage identity recovery pipeline.
 * Delegates to PINIT Original Identity Recovery Algorithm (7-stage).
 */
import { pinitOriginalIdentityRecoveryService } from './pinit-original-identity-recovery.service';
import type { PinitIdentificationResult, RecoveryStage } from './pinit-identification-engine.service';

export type { RecoveryStage };
export type EnterpriseRecoveryResult = PinitIdentificationResult;

export class EnterpriseRecoveryPipeline {
  async run(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
  ): Promise<EnterpriseRecoveryResult> {
    return pinitOriginalIdentityRecoveryService.recover(
      buffer,
      mimeType,
      originalName,
      sizeBytes,
      ownerUserId,
    );
  }
}

export const enterpriseRecoveryPipeline = new EnterpriseRecoveryPipeline();
