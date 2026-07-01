/**
 * Resolves watermark proof status for Unified Investigation reports.
 */
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
      vaultId: context.vaultId,
      ownerPinitId: context.ownerPinitId,
      confidence: leakVerify.confidence ?? 99,
    };
  }

  if (leakVerify.valid && leakVerify.found) {
    return {
      status: 'DETECTED',
      code: leakVerify.identity?.vaultId?.slice(0, 12) ?? 'EMBEDDED-IDENTITY',
      extractionMethod: leakVerify.detectionMethod ?? 'EMBEDDED_IDENTITY',
      vaultId: context.vaultId,
      ownerPinitId: context.ownerPinitId,
      confidence: leakVerify.confidence ?? 95,
      reason: 'Forensic identity signature/manifest recovered — unique vault linkage (QR-equivalent)',
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

  if (context.vaultId && leakVerify.found) {
    return {
      status: 'DAMAGED',
      reason: 'Vault match confirmed via DNA — watermark may be damaged in this copy (screenshot/re-encode).',
    };
  }

  return {
    status: 'NOT_EMBEDDED',
    reason: 'No forensic identity detected. Download from Vault Explorer to embed lifetime tracking markers.',
  };
}
