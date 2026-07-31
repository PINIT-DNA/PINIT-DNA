/**
 * Enterprise multi-stage identity recovery pipeline.
 * When ENTERPRISE_PIPELINE_V2 is ON → single-pass enterprise investigation pipeline.
 * Otherwise → legacy PINIT Original Identity Recovery Algorithm (7-stage).
 *
 * Always tries Protected Download / TEP / exact-hash fast identity FIRST so
 * untampered protected exports never wait on the heavy V2 DNA path.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { pinitOriginalIdentityRecoveryService } from './pinit-original-identity-recovery.service';
import type { PinitIdentificationResult, RecoveryStage } from './pinit-identification-engine.service';
import type { RecoveryOptions } from './pinit-original-identity-recovery.service';
import {
  enterpriseInvestigationPipeline,
  isEnterprisePipelineV2Enabled,
} from './enterprise-investigation-pipeline.service';
import { leakedFileVerifyService } from './leaked-file-verify.service';
import {
  emptyEnterpriseForLeakPromote,
  ensureLeakVaultId,
  isStrongLeakIdentity,
  promoteLeakVerifyToAuthoritative,
} from './leak-verify-authoritative-bridge.service';
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
    // ── Fast path: Protected Download / TEP / embedded identity ─────────────
    try {
      const leakRaw = await leakedFileVerifyService.verify(
        buffer,
        mimeType,
        originalName,
        { lightweight: true, ownerUserId },
      );
      const leak = await ensureLeakVaultId(leakRaw);
      if (isStrongLeakIdentity(leak) && leak.identity?.vaultId) {
        logger.info('[EnterpriseRecovery] Fast path — strong leak/TEP identity', {
          method: leak.detectionMethod,
          vaultId: leak.identity.vaultId.slice(0, 8),
          confidence: leak.confidence,
        });
        options?.onProgress?.({
          type: 'phase',
          stepId: 'identity_recovery',
          label: 'Identity Recovery',
          status: 'complete',
          detail: leak.message,
          snapshot: {
            phase: 1,
            signatureFound: true,
            vaultId: leak.identity.vaultId,
            dnaRecordId: leak.identity.dnaId!,
            ownerName: leak.identity.ownerName,
            ownerPinitId: leak.identity.ownerShortId,
            originalFilename: leak.identity.originalFilename,
            confidence: leak.confidence ?? 97,
            statusMessage: 'Protected download / TEP identity found',
          },
        });
        return promoteLeakVerifyToAuthoritative(
          emptyEnterpriseForLeakPromote(),
          leak,
          ownerUserId,
        );
      }
    } catch (err) {
      logger.warn('[EnterpriseRecovery] Leak fast path failed (continuing)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Fast path: exact SHA-256 of vault DNA (true original bytes) ─────────
    try {
      const sha = crypto.createHash('sha256').update(buffer).digest('hex');
      const exact = await prisma.dnaRecord.findFirst({
        where: { sha256Hash: sha, ownerUserId, vaultRecord: { isNot: null } },
        include: { vaultRecord: true },
      });
      if (exact?.vaultRecord) {
        logger.info('[EnterpriseRecovery] Fast path — SHA-256 exact vault match', {
          vaultId: exact.vaultRecord.id.slice(0, 8),
        });
        // Delegate to legacy recover which has the full exact-hash result builder
        return pinitOriginalIdentityRecoveryService.recover(
          buffer, mimeType, originalName, sizeBytes, ownerUserId, options,
        );
      }
    } catch (err) {
      logger.warn('[EnterpriseRecovery] SHA fast path failed (continuing)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (isEnterprisePipelineV2Enabled()) {
      // Unified Investigation depends on live vault leads (onProgress). V2 does not
      // emit them and often burns the full 150s stage budget on WhatsApp/tampered
      // recompress probes → Incomplete/Unknown with vaultId=null. Keep TEP/SHA
      // fast paths above; use legacy recovery for live investigation progress.
      if (options?.onProgress) {
        logger.info('[EnterpriseRecovery] Legacy recovery for live investigation (V2 skips onProgress)');
        return pinitOriginalIdentityRecoveryService.recover(
          buffer, mimeType, originalName, sizeBytes, ownerUserId, options,
        );
      }
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
