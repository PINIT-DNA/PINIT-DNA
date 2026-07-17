/**
 * Enterprise multi-stage identity recovery pipeline.
 * When ENTERPRISE_PIPELINE_V2 is ON → single-pass enterprise investigation pipeline.
 * Otherwise → legacy PINIT Original Identity Recovery Algorithm (7-stage).
 */
import { pinitOriginalIdentityRecoveryService } from './pinit-original-identity-recovery.service';
import type { PinitIdentificationResult, RecoveryStage } from './pinit-identification-engine.service';
import type { RecoveryOptions } from './pinit-original-identity-recovery.service';
import {
  enterpriseInvestigationPipeline,
  isEnterprisePipelineV2Enabled,
} from './enterprise-investigation-pipeline.service';
import { logger } from '../../lib/logger';

export type { RecoveryStage };
export type EnterpriseRecoveryResult = PinitIdentificationResult;

export class EnterpriseRecoveryPipeline {
  async run(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
    options?: RecoveryOptions,
  ): Promise<EnterpriseRecoveryResult> {
    if (isEnterprisePipelineV2Enabled()) {
      logger.info('[EnterpriseRecovery] ENTERPRISE_PIPELINE_V2 path');
      const input = {
        buffer,
        mimeType,
        originalName,
        sizeBytes,
        ownerUserId,
      };
      const run = await enterpriseInvestigationPipeline.run(input);
      return enterpriseInvestigationPipeline.toIdentificationResult(run, input);
    }

    return pinitOriginalIdentityRecoveryService.recover(
      buffer,
      mimeType,
      originalName,
      sizeBytes,
      ownerUserId,
      options,
    );
  }
}

export const enterpriseRecoveryPipeline = new EnterpriseRecoveryPipeline();
