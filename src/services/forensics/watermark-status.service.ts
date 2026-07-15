/**
 * Resolves watermark proof status for Unified Investigation reports.
 * Ownership recovered via DNA/visual must NEVER contradict with NOT_EMBEDDED
 * without an explicit derivative explanation.
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
  context: {
    vaultId?: string;
    ownerPinitId?: string;
    /** True when investigation recovered vault owner via DNA/visual (not watermark) */
    ownershipRecovered?: boolean;
    dnaMatchPercent?: number;
    visualScore?: number;
  },
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
      reason: 'Forensic identity signature/manifest recovered — unique vault linkage',
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
        'Watermark was embedded in this file lineage (share/TEP export) but could not be fully recovered from the submitted copy (crop/compress/screenshot often damages it).',
      vaultId: context.vaultId,
      ownerPinitId: context.ownerPinitId,
      confidence: Math.max(40, leakVerify.confidence ?? 40),
    };
  }

  if (leakVerify.tampered && leakVerify.found && leakVerify.detectionMethod === 'EMBEDDED_IDENTITY') {
    return {
      status: 'DAMAGED',
      reason: 'File was modified after protection; embedded watermark may have been damaged.',
      vaultId: context.vaultId,
      ownerPinitId: context.ownerPinitId,
    };
  }

  // Ownership recovered via DNA/visual — do not claim NOT_EMBEDDED (contradicts recovery)
  if (context.vaultId && (context.ownershipRecovered || leakVerify.found
    || (context.dnaMatchPercent != null && context.dnaMatchPercent >= 40)
    || (context.visualScore != null && context.visualScore >= 50))) {
    return {
      status: 'DAMAGED',
      reason:
        'Original owner recovered via DNA / visual vault match. '
        + 'No recoverable watermark in this derivative (expected for cropped, compressed, or WhatsApp re-encoded copies). '
        + 'Watermark absence does not overturn ownership.',
      vaultId: context.vaultId,
      ownerPinitId: context.ownerPinitId,
      confidence: Math.max(
        context.dnaMatchPercent ?? 0,
        context.visualScore ?? 0,
        55,
      ),
      extractionMethod: 'DNA_VISUAL_VAULT_MATCH',
    };
  }

  return {
    status: 'NOT_EMBEDDED',
    reason: 'No forensic identity or vault match. Download from Vault Explorer to embed lifetime tracking markers.',
  };
}
