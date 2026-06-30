/**
 * Enterprise multi-stage identity recovery pipeline.
 * Delegates to PINIT Identification Engine (12-stage exhaustive recovery).
 */
import {
  pinitIdentificationEngine,
  type PinitIdentificationResult,
  type RecoveryStage,
} from './pinit-identification-engine.service';

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
    return pinitIdentificationEngine.identify(
      buffer,
      mimeType,
      originalName,
      sizeBytes,
      ownerUserId,
    );
  }
}

export const enterpriseRecoveryPipeline = new EnterpriseRecoveryPipeline();
