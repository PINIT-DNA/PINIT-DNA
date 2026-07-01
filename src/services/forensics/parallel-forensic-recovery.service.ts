/**
 * Parallel Stage-1 forensic recovery — watermark, token, manifest, OCR run concurrently.
 */
import { phase3WatermarkRecovery } from '../watermark/phase3-watermark-recovery.service';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { extractManifest } from '../identity/integrity-manifest.service';
import { verifyRecoveryToken, RECOVERY_TOKEN_PREFIX } from '../identity/recovery-token.service';
import { forensicComputationCache } from './forensic-computation-cache.service';
import { prisma } from '../../lib/prisma';
import { withTimeoutSoft } from '../../lib/safe-runner';
import type { VaultMatchResult } from './vault-auto-match.service';

export interface ParallelForensicOptions {
  /** Skip slow multi-pass OCR (investigation fast path for tampered/compressed files) */
  skipOcr?: boolean;
  watermarkTimeoutMs?: number;
  embeddingTimeoutMs?: number;
}

export interface ParallelForensicResult {
  watermarkScore: number;
  identityTokenScore: number;
  manifestScore: number;
  ocrScore: number;
  watermarkRecovered: boolean;
  identityTokenRecovered: boolean;
  manifestRecovered: boolean;
  identityHit: VaultMatchResult | null;
  signals: Array<{ stage: string; score: number; recovered: boolean; detail: string }>;
}

export async function runParallelForensicRecovery(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
  ownerUserId: string,
  options?: ParallelForensicOptions,
): Promise<ParallelForensicResult> {
  const result: ParallelForensicResult = {
    watermarkScore: 0,
    identityTokenScore: 0,
    manifestScore: 0,
    ocrScore: 0,
    watermarkRecovered: false,
    identityTokenRecovered: false,
    manifestRecovered: false,
    identityHit: null,
    signals: [],
  };

  const push = (stage: string, score: number, recovered: boolean, detail: string) => {
    result.signals.push({ stage, score, recovered, detail });
  };

  const wmTimeout = options?.watermarkTimeoutMs ?? 5_000;
  const embTimeout = options?.embeddingTimeoutMs ?? 5_000;

  const [wmRes, tokenRes, manifestRes, ocrRes] = await Promise.allSettled([
    withTimeoutSoft(
      () => phase3WatermarkRecovery.recoverForensic(buffer, mimeType, ownerUserId),
      wmTimeout,
      'watermark_recovery',
    ),
    withTimeoutSoft(
      () => identityEmbeddingService.extractLoose(buffer, mimeType, originalName),
      embTimeout,
      'identity_embedding',
    ),
    Promise.resolve(extractManifest(buffer)),
    !options?.skipOcr && mimeType.startsWith('image/')
      ? withTimeoutSoft(async () => {
        const { pinitSignatureDetector } = await import('../duplicate/pinit-signature-detector.service');
        return pinitSignatureDetector.detect(buffer, mimeType, originalName);
      }, 4_000, 'investigation_ocr')
      : Promise.resolve(null),
  ]);

  if (wmRes.status === 'fulfilled' && wmRes.value?.recovered) {
    result.watermarkRecovered = true;
    result.watermarkScore = wmRes.value.tokenValid ? 94 : 72;
    push('stage1_forensic_recovery', result.watermarkScore, true, 'Watermark (parallel)');
    if (wmRes.value.vaultId && wmRes.value.dnaRecordId) {
      result.identityHit = {
        tier: 2,
        method: 'Invisible watermark',
        dnaRecordId: wmRes.value.dnaRecordId,
        vaultId: wmRes.value.vaultId,
        ownerUserId: wmRes.value.ownerUserId ?? ownerUserId,
        confidence: 'HIGH',
      };
    }
  }

  const latin = buffer.toString('latin1');
  const rvtIdx = latin.indexOf(RECOVERY_TOKEN_PREFIX);
  if (rvtIdx >= 0) {
    const verified = verifyRecoveryToken(latin.slice(rvtIdx, rvtIdx + 800));
    if (verified.valid && verified.payload?.ownerUserId === ownerUserId) {
      result.identityTokenRecovered = true;
      result.identityTokenScore = 88;
      push('stage1_forensic_recovery', result.identityTokenScore, true, verified.detail);
      if (!result.identityHit) {
        result.identityHit = {
          tier: 2,
          method: 'Recovery token',
          dnaRecordId: verified.payload.dnaRecordId,
          vaultId: verified.payload.vaultId,
          ownerUserId: verified.payload.ownerUserId,
          confidence: 'HIGH',
        };
      }
    }
  }

  if (tokenRes.status === 'fulfilled' && tokenRes.value?.found && tokenRes.value.dnaId && tokenRes.value.vaultId) {
    const rec = await prisma.dnaRecord.findUnique({ where: { id: tokenRes.value.dnaId }, select: { ownerUserId: true } });
    if (rec?.ownerUserId === ownerUserId) {
      result.identityTokenRecovered = true;
      result.identityTokenScore = Math.max(result.identityTokenScore, tokenRes.value.valid ? 95 : 68);
      push('stage1_forensic_recovery', result.identityTokenScore, true, 'Embedded signature (parallel)');
      if (!result.identityHit) {
        result.identityHit = {
          tier: 2,
          method: 'Embedded identity',
          dnaRecordId: tokenRes.value.dnaId,
          vaultId: tokenRes.value.vaultId,
          ownerUserId: tokenRes.value.ownerUserId ?? ownerUserId,
          confidence: tokenRes.value.valid ? 'HIGH' : 'MEDIUM',
        };
      }
    }
  }

  if (manifestRes.status === 'fulfilled' && manifestRes.value?.ownerUserId === ownerUserId && manifestRes.value.vaultId) {
    result.manifestRecovered = true;
    result.manifestScore = 92;
    push('stage1_forensic_recovery', result.manifestScore, true, 'Manifest (parallel)');
    if (!result.identityHit) {
      result.identityHit = {
        tier: 2,
        method: 'Integrity manifest',
        dnaRecordId: manifestRes.value.dnaRecordId,
        vaultId: manifestRes.value.vaultId,
        ownerUserId: manifestRes.value.ownerUserId,
        confidence: 'HIGH',
      };
    }
  }

  if (ocrRes.status === 'fulfilled' && ocrRes.value) {
    const sig = ocrRes.value;
    if (sig.detected || sig.signals.length) {
      result.ocrScore = sig.dnaRecordId ? 92 : 70;
      push('stage1_forensic_recovery', result.ocrScore, true, `OCR: ${sig.signals.slice(0, 3).join(', ')}`);
      if (!result.identityHit && sig.dnaRecordId) {
        const vaultRow = await prisma.vaultRecord.findFirst({ where: { dnaRecordId: sig.dnaRecordId } });
        if (vaultRow) {
          result.identityHit = {
            tier: 2,
            method: 'Share-viewer visible watermark OCR',
            dnaRecordId: sig.dnaRecordId,
            vaultId: vaultRow.id,
            ownerUserId: sig.ownerUserId ?? ownerUserId,
            confidence: 'HIGH',
          };
        }
      }
    }
  }

  return result;
}
