/**
 * Resolves watermark proof status for Unified Investigation reports.
 */
import { isInvisibleWatermarkVaultEmbeddingEnabled } from '../../config/watermark';
import type { LeakedFileVerifyResult } from './leaked-file-verify.service';

export type WatermarkProofStatus = 'DETECTED' | 'DAMAGED' | 'NOT_EMBEDDED';

export interface WatermarkProof {
  status: WatermarkProofStatus;
  reason?: string;
  code?: string;
  extractionMethod?: string;
  vaultId?: string;
  ownerPinitId?: string;
  confidence?: number;
}

export function resolveWatermarkProof(
  leakVerify: LeakedFileVerifyResult,
  context: { vaultId?: string; ownerPinitId?: string },
  phase3?: { recovered: boolean; tokenValid?: boolean; method?: string },
): WatermarkProof {
  const code = leakVerify.watermark?.code;

  if (code || (phase3?.recovered && phase3.tokenValid)) {
    return {
      status: 'DETECTED',
      code: code ?? 'PHASE3-TOKEN',
      extractionMethod: phase3?.method ?? leakVerify.watermark?.extractionMethod,
      vaultId: context.vaultId ?? leakVerify.identity?.vaultId,
      ownerPinitId: context.ownerPinitId ?? leakVerify.identity?.ownerShortId,
      confidence: leakVerify.confidence ?? 99,
    };
  }

  const watermarkLineage =
    leakVerify.detectionMethod === 'WATERMARK' ||
    leakVerify.detectionMethod === 'TEP_EXPORT' ||
    leakVerify.leakVector === 'DOWNLOAD_REUPLOAD' ||
    !!leakVerify.tep?.code;

  if (watermarkLineage) {
    return {
      status: 'DAMAGED',
      reason:
        'Watermark was embedded in this file lineage (share/TEP export) but could not be fully recovered from the submitted copy.',
    };
  }

  if (leakVerify.tampered && leakVerify.found && leakVerify.detectionMethod === 'EMBEDDED_IDENTITY') {
    return {
      status: 'DAMAGED',
      reason: 'File was modified after protection; any embedded watermark may have been damaged.',
    };
  }

  if (!isInvisibleWatermarkVaultEmbeddingEnabled()) {
    return {
      status: 'NOT_EMBEDDED',
      reason: 'Invisible watermark embedding is not enabled for this file.',
    };
  }

  return {
    status: 'NOT_EMBEDDED',
    reason: 'No invisible watermark detected in this file.',
  };
}
