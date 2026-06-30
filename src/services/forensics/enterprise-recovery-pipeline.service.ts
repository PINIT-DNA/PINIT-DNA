/**
 * Enterprise multi-stage identity recovery pipeline.
 * Exhausts watermark → token → manifest → visual DNA → vault search before declaring unknown.
 */
import crypto from 'crypto';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { extractManifest } from '../identity/integrity-manifest.service';
import { verifyRecoveryToken, RECOVERY_TOKEN_PREFIX } from '../identity/recovery-token.service';
import { phase3WatermarkRecovery } from '../watermark/phase3-watermark-recovery.service';
import { forensicImagePreprocessor } from './forensic-image-preprocessor.service';
import { vaultCandidateRankingService } from './vault-candidate-ranking.service';
import { vaultAutoMatchService, type VaultMatchResult } from './vault-auto-match.service';
import { confidenceFusionEngine, type FusionResult } from './confidence-fusion-engine.service';
import { isCameraScanFileName, candidateHasVisualSignal } from './vault-match-validator.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';

export interface RecoveryStage {
  stage: string;
  status: 'complete' | 'partial' | 'failed' | 'skipped';
  detail: string;
}

export interface EnterpriseRecoveryResult {
  match: VaultMatchResult | null;
  probableMatch: VaultMatchResult | null;
  candidates: RankedVaultCandidate[];
  fusion: FusionResult;
  stages: RecoveryStage[];
  variantCount: number;
  manifestRecovered: boolean;
  identityTokenRecovered: boolean;
  watermarkRecovered: boolean;
}

const PROBABLE_THRESHOLD = 58;

export class EnterpriseRecoveryPipeline {
  async run(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
  ): Promise<EnterpriseRecoveryResult> {
    const stages: RecoveryStage[] = [];
    const variants = await forensicImagePreprocessor.generateVariants(buffer, mimeType);
    stages.push({
      stage: 'image_preprocessing',
      status: 'complete',
      detail: `${variants.length} forensic variant(s) — normalize, denoise, contrast`,
    });

    let match: VaultMatchResult | null = null;
    let manifestRecovered = false;
    let identityTokenRecovered = false;
    let watermarkRecovered = false;
    let manifestScore = 0;
    let identityTokenScore = 0;
    let watermarkScore = 0;
    let sha256Score = 0;

    const uploadedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const exact = await prisma.dnaRecord.findFirst({
      where: { sha256Hash: uploadedHash, ownerUserId, vaultRecord: { isNot: null } },
      include: { vaultRecord: true },
    });
    if (exact?.vaultRecord) {
      sha256Score = 100;
      match = {
        tier: 1,
        method: 'SHA-256 exact hash',
        dnaRecordId: exact.id,
        vaultId: exact.vaultRecord.id,
        ownerUserId: exact.ownerUserId ?? ownerUserId,
        confidence: 'EXACT',
      };
      stages.push({ stage: 'sha256', status: 'complete', detail: 'Exact hash match' });
    }

    for (const variant of variants) {
      if (match) break;

      const manifest = extractManifest(variant.buffer);
      if (manifest?.ownerUserId === ownerUserId && manifest.vaultId) {
        const vaultOk = await prisma.vaultRecord.findUnique({ where: { id: manifest.vaultId } });
        if (vaultOk) {
          manifestRecovered = true;
          manifestScore = 92;
          match = {
            tier: 2,
            method: `Integrity manifest (${variant.label})`,
            dnaRecordId: manifest.dnaRecordId,
            vaultId: manifest.vaultId,
            ownerUserId: manifest.ownerUserId,
            confidence: 'HIGH',
          };
          stages.push({ stage: 'manifest_recovery', status: 'complete', detail: `Manifest on ${variant.label}` });
          break;
        }
      }

      const latin = variant.buffer.toString('latin1');
      const rvtIdx = latin.indexOf(RECOVERY_TOKEN_PREFIX);
      if (rvtIdx >= 0) {
        const slice = latin.slice(rvtIdx, rvtIdx + 800);
        const verified = verifyRecoveryToken(slice);
        if (verified.valid && verified.payload?.ownerUserId === ownerUserId) {
          identityTokenRecovered = true;
          identityTokenScore = Math.max(identityTokenScore, 88);
          const vaultOk = await prisma.vaultRecord.findUnique({ where: { id: verified.payload.vaultId } });
          if (vaultOk && !match) {
            match = {
              tier: 2,
              method: `Recovery token (${variant.label})`,
              dnaRecordId: verified.payload.dnaRecordId,
              vaultId: verified.payload.vaultId,
              ownerUserId: verified.payload.ownerUserId,
              confidence: 'HIGH',
            };
            stages.push({ stage: 'recovery_token', status: 'complete', detail: verified.detail });
          }
        }
      }

      try {
        const id = await identityEmbeddingService.extractLoose(variant.buffer, variant.mimeType, originalName);
        if (id.found && id.dnaId && id.vaultId) {
          const dnaRec = await prisma.dnaRecord.findUnique({
            where: { id: id.dnaId },
            select: { ownerUserId: true },
          });
          if (dnaRec?.ownerUserId === ownerUserId) {
            identityTokenRecovered = true;
            identityTokenScore = Math.max(identityTokenScore, id.valid ? 95 : 68);
            if (!match) {
              match = {
                tier: 2,
                method: `Embedded identity (${variant.label}${id.tampered ? ', modified' : ''})`,
                dnaRecordId: id.dnaId,
                vaultId: id.vaultId,
                ownerUserId: id.ownerUserId ?? ownerUserId,
                confidence: id.valid ? 'HIGH' : 'MEDIUM',
              };
              stages.push({
                stage: 'identity_signature',
                status: id.valid ? 'complete' : 'partial',
                detail: `Cryptographic signature via ${variant.label}`,
              });
            }
          }
        }
      } catch { /* continue */ }

      try {
        const wm = await phase3WatermarkRecovery.recoverForensic(variant.buffer, variant.mimeType, ownerUserId);
        if (wm.recovered) {
          watermarkRecovered = true;
          watermarkScore = Math.max(watermarkScore, wm.tokenValid ? 94 : 72);
          if (!match && wm.vaultId && wm.dnaRecordId) {
            match = {
              tier: 2,
              method: `Invisible watermark (${variant.label})`,
              dnaRecordId: wm.dnaRecordId,
              vaultId: wm.vaultId,
              ownerUserId: wm.ownerUserId ?? ownerUserId,
              confidence: wm.tokenValid ? 'HIGH' : 'MEDIUM',
            };
            stages.push({ stage: 'watermark_recovery', status: 'complete', detail: wm.detail });
          }
        }
      } catch { /* continue */ }
    }

    if (!manifestRecovered) {
      stages.push({ stage: 'manifest_recovery', status: match ? 'skipped' : 'failed', detail: 'No signed manifest' });
    }
    if (!identityTokenRecovered && !match) {
      stages.push({ stage: 'identity_signature', status: 'failed', detail: 'No identity token on any variant' });
    }
    if (!watermarkRecovered && !match) {
      stages.push({ stage: 'watermark_recovery', status: 'failed', detail: 'Watermark not recovered — continuing visual DNA' });
    }

    const isCamera = isCameraScanFileName(originalName);
    let candidates: RankedVaultCandidate[] = [];

    for (const variant of variants) {
      const ranked = await vaultCandidateRankingService.findRankedCandidates(
        variant.buffer,
        variant.mimeType,
        originalName,
        sizeBytes,
        ownerUserId,
        { relaxedVisual: isCamera || variant.label !== 'original' },
      );
      for (const c of ranked) {
        const existing = candidates.find((x) => x.vaultId === c.vaultId);
        if (!existing || c.compositeScore > existing.compositeScore) {
          if (existing) {
            existing.compositeScore = Math.max(existing.compositeScore, c.compositeScore);
            existing.signals = [...new Set([...existing.signals, ...c.signals, `variant:${variant.label}`])];
          } else {
            candidates.push({ ...c, signals: [...c.signals, `variant:${variant.label}`] });
          }
        }
      }
    }

    candidates = candidates
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, 100)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    stages.push({
      stage: 'vault_dna_search',
      status: candidates.length ? 'complete' : 'failed',
      detail: candidates.length
        ? `Top match ${candidates[0]!.compositeScore}% · ${candidates.length} candidates`
        : 'No vault candidates',
    });

    if (!match) {
      match = vaultCandidateRankingService.selectBestCandidate(candidates, PROBABLE_THRESHOLD);
    }

    if (!match) {
      for (const variant of variants) {
        const m = await vaultAutoMatchService.findMatch(
          variant.buffer,
          variant.mimeType,
          originalName,
          sizeBytes,
          ownerUserId,
          { phashThreshold: isCamera ? 0.62 : 0.78 },
        );
        if (m) {
          match = { ...m, method: `${m.method} (${variant.label})` };
          break;
        }
      }
    }

    const bestCandidate = candidates[0] ?? null;
    const probableCandidate = bestCandidate
      && bestCandidate.compositeScore >= PROBABLE_THRESHOLD
      && candidateHasVisualSignal(bestCandidate)
      ? bestCandidate
      : null;

    const probableMatch = !match && probableCandidate
      ? vaultCandidateRankingService.toVaultMatch(probableCandidate)
      : null;

    const effectiveMatch = match ?? probableMatch;
    const visualScore = bestCandidate?.compositeScore
      ?? (effectiveMatch?.visualSimilarity ? Math.round(effectiveMatch.visualSimilarity * 100) : 0);

    const fusion = confidenceFusionEngine.fuse({
      watermarkScore,
      identityTokenScore,
      manifestScore,
      sha256Score,
      visualDnaScore: visualScore,
      perceptualHashScore: visualScore,
      structuralScore: bestCandidate?.signals.includes('perceptual_hash') ? visualScore * 0.94 : visualScore * 0.7,
      semanticScore: candidates.find((c) => c.signals.includes('semantic_dna'))?.compositeScore ?? 0,
      textureScore: visualScore * 0.92,
      candidate: bestCandidate,
      match: effectiveMatch,
    });

    stages.push({
      stage: 'confidence_fusion',
      status: fusion.ownershipConfidence >= PROBABLE_THRESHOLD ? 'complete' : 'partial',
      detail: `Ownership confidence ${fusion.ownershipConfidence}%`,
    });

    if (probableMatch && !match) {
      logger.info('[EnterpriseRecovery] Probable vault match', {
        score: bestCandidate?.compositeScore,
        vaultId: probableMatch.vaultId,
      });
    }

    return {
      match,
      probableMatch,
      candidates,
      fusion,
      stages,
      variantCount: variants.length,
      manifestRecovered,
      identityTokenRecovered,
      watermarkRecovered,
    };
  }
}

export const enterpriseRecoveryPipeline = new EnterpriseRecoveryPipeline();
