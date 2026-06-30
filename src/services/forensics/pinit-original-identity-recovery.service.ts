/**
 * PINIT Original Identity Recovery Algorithm — enterprise 7-stage pipeline.
 *
 * Goal: given any transformed capture, determine if it originated from a PINIT vault asset.
 * Never stop when watermark/token fail. Never guess — false positives blocked by margin + anchors.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { extractManifest } from '../identity/integrity-manifest.service';
import { verifyRecoveryToken, RECOVERY_TOKEN_PREFIX } from '../identity/recovery-token.service';
import { phase3WatermarkRecovery } from '../watermark/phase3-watermark-recovery.service';
import { certificateService } from '../certificates/certificate.service';
import { EphemeralFingerprinter } from '../verification/ephemeral-fingerprinter';
import { forensicImagePreprocessor } from './forensic-image-preprocessor.service';
import { vaultSimilarityVectorService } from './vault-similarity-vector.service';
import { deepVaultCompareService } from './deep-vault-compare.service';
import { confidenceFusionEngine } from './confidence-fusion-engine.service';
import { vaultCandidateRankingService } from './vault-candidate-ranking.service';
import { pinitIdentificationConfig } from '../../config/pinit-identification';
import type { VaultMatchResult } from './vault-auto-match.service';
import type {
  PinitIdentificationResult,
  RecoveryStage,
  RecoveredIdentitySignal,
} from './pinit-identification-engine.service';

const STAGE = {
  FORENSIC: 'stage1_forensic_recovery',
  PROBE_DNA: 'stage2_probe_dna',
  VAULT_SEARCH: 'stage3_vault_search',
  SIMILARITY_VECTOR: 'stage4_similarity_vector',
  DEEP_COMPARE: 'stage5_deep_dna_compare',
  FUSION: 'stage6_confidence_fusion',
  DECISION: 'stage7_decision',
} as const;

export class PinitOriginalIdentityRecoveryService {
  private readonly probeFingerprinter = new EphemeralFingerprinter();

  async recover(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
  ): Promise<PinitIdentificationResult> {
    const stages: RecoveryStage[] = [];
    const recoveredSignals: RecoveredIdentitySignal[] = [];
    const push = (stage: string, score: number, recovered: boolean, detail: string) => {
      recoveredSignals.push({ stage, score, recovered, detail });
    };

    let watermarkScore = 0;
    let identityTokenScore = 0;
    let manifestScore = 0;
    let certificateScore = 0;
    let sha256Score = 0;
    let ocrScore = 0;
    let watermarkRecovered = false;
    let identityTokenRecovered = false;
    let manifestRecovered = false;

    let identityHit: VaultMatchResult | null = null;
    let certificateId: string | null = null;
    let ownerShortId: string | null = null;

    const variants = await forensicImagePreprocessor.generateVariants(buffer, mimeType);

    // ═══ Stage 1 — Forensic recovery (never stop) ═══════════════════════════
    for (const variant of variants) {
      try {
        const wm = await phase3WatermarkRecovery.recoverForensic(variant.buffer, variant.mimeType, ownerUserId);
        if (wm.recovered) {
          watermarkRecovered = true;
          watermarkScore = Math.max(watermarkScore, wm.tokenValid ? 94 : 72);
          push(STAGE.FORENSIC, watermarkScore, true, `Watermark (${variant.label})`);
          if (!identityHit && wm.vaultId && wm.dnaRecordId) {
            identityHit = {
              tier: 2, method: `Invisible watermark (${variant.label})`,
              dnaRecordId: wm.dnaRecordId, vaultId: wm.vaultId,
              ownerUserId: wm.ownerUserId ?? ownerUserId, confidence: 'HIGH',
            };
          }
        }
      } catch { /* continue */ }

      const latin = variant.buffer.toString('latin1');
      const rvtIdx = latin.indexOf(RECOVERY_TOKEN_PREFIX);
      if (rvtIdx >= 0) {
        const verified = verifyRecoveryToken(latin.slice(rvtIdx, rvtIdx + 800));
        if (verified.valid && verified.payload?.ownerUserId === ownerUserId) {
          identityTokenRecovered = true;
          identityTokenScore = Math.max(identityTokenScore, 88);
          push(STAGE.FORENSIC, identityTokenScore, true, verified.detail);
          if (!identityHit) {
            identityHit = {
              tier: 2, method: `Recovery token (${variant.label})`,
              dnaRecordId: verified.payload.dnaRecordId, vaultId: verified.payload.vaultId,
              ownerUserId: verified.payload.ownerUserId, confidence: 'HIGH',
            };
          }
        }
      }

      try {
        const id = await identityEmbeddingService.extractLoose(variant.buffer, variant.mimeType, originalName);
        if (id.found && id.dnaId && id.vaultId) {
          const rec = await prisma.dnaRecord.findUnique({ where: { id: id.dnaId }, select: { ownerUserId: true } });
          if (rec?.ownerUserId === ownerUserId) {
            identityTokenRecovered = true;
            identityTokenScore = Math.max(identityTokenScore, id.valid ? 95 : 68);
            push(STAGE.FORENSIC, identityTokenScore, true, `Embedded signature (${variant.label})`);
            if (!identityHit) {
              identityHit = {
                tier: 2, method: `Embedded identity (${variant.label})`,
                dnaRecordId: id.dnaId, vaultId: id.vaultId,
                ownerUserId: id.ownerUserId ?? ownerUserId, confidence: id.valid ? 'HIGH' : 'MEDIUM',
              };
            }
          }
        }
      } catch { /* continue */ }

      const manifest = extractManifest(variant.buffer);
      if (manifest?.ownerUserId === ownerUserId && manifest.vaultId) {
        manifestRecovered = true;
        manifestScore = Math.max(manifestScore, 92);
        push(STAGE.FORENSIC, manifestScore, true, `Manifest (${variant.label})`);
        if (!identityHit) {
          identityHit = {
            tier: 2, method: `Integrity manifest (${variant.label})`,
            dnaRecordId: manifest.dnaRecordId, vaultId: manifest.vaultId,
            ownerUserId: manifest.ownerUserId, confidence: 'HIGH',
          };
        }
      }
    }

    if (mimeType.startsWith('image/')) {
      try {
        const { pinitSignatureDetector } = await import('../duplicate/pinit-signature-detector.service');
        const sig = await pinitSignatureDetector.detect(buffer, mimeType, originalName);
        if (sig.detected || sig.signals.length) {
          ocrScore = Math.max(ocrScore, sig.dnaRecordId ? 92 : 70);
          push(STAGE.FORENSIC, ocrScore, true, `Share-viewer OCR: ${sig.signals.slice(0, 3).join(', ')}`);
          if (!identityHit && sig.dnaRecordId) {
            const vaultRow = await prisma.vaultRecord.findFirst({ where: { dnaRecordId: sig.dnaRecordId } });
            if (vaultRow) {
              identityHit = {
                tier: 2, method: 'Share-viewer visible watermark OCR',
                dnaRecordId: sig.dnaRecordId, vaultId: vaultRow.id,
                ownerUserId: sig.ownerUserId ?? ownerUserId, confidence: 'HIGH',
              };
              ownerShortId = sig.ownerShortId ?? ownerShortId;
            }
          }
        }
      } catch { /* optional */ }
    }

    stages.push({
      stage: STAGE.FORENSIC,
      status: watermarkRecovered || identityTokenRecovered || manifestRecovered ? 'complete' : 'partial',
      detail: `Watermark ${watermarkScore}% · Token ${identityTokenScore}% · Manifest ${manifestScore}% · OCR ${ocrScore}%`,
    });

    const uploadedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const exact = await prisma.dnaRecord.findFirst({
      where: { sha256Hash: uploadedHash, ownerUserId, vaultRecord: { isNot: null } },
      include: { vaultRecord: true, ownerUser: { select: { shortId: true } } },
    });
    if (exact?.vaultRecord) {
      sha256Score = 100;
      identityHit = {
        tier: 1, method: 'SHA-256 exact hash',
        dnaRecordId: exact.id, vaultId: exact.vaultRecord.id,
        ownerUserId: exact.ownerUserId ?? ownerUserId, confidence: 'EXACT',
      };
      ownerShortId = exact.ownerUser?.shortId ?? ownerShortId;
    }

    // ═══ Stage 2 — Fresh 15-layer DNA on probe ════════════════════════════
    let probeLayerCount = 0;
    try {
      const probeFp = await this.probeFingerprinter.fingerprint({
        filePath: '', originalName, declaredMimeType: mimeType, sizeBytes, buffer,
      });
      probeLayerCount = probeFp.layers.filter((l) => l.success).length;
      stages.push({
        stage: STAGE.PROBE_DNA,
        status: probeLayerCount >= 8 ? 'complete' : 'partial',
        detail: `Probe DNA: ${probeLayerCount}/15 layers generated`,
      });
    } catch (e) {
      stages.push({ stage: STAGE.PROBE_DNA, status: 'failed', detail: `Probe DNA failed: ${String(e).slice(0, 80)}` });
    }

    // ═══ Stages 3–4 — Score ENTIRE vault (similarity vectors) ═════════════
    const vectors = await vaultSimilarityVectorService.scoreEntireVault(
      buffer, mimeType, originalName, sizeBytes, ownerUserId, variants,
      { relaxedVisual: true, orbTopK: 15 },
    );
    let candidates = vaultSimilarityVectorService.toRankedCandidates(vectors);

    stages.push({
      stage: STAGE.VAULT_SEARCH,
      status: vectors.length ? 'complete' : 'failed',
      detail: vectors.length
        ? `Scored ${vectors.length} vault assets — top vector ${vectors[0]!.scores.composite}%`
        : 'No vault similarity vectors',
    });

    stages.push({
      stage: STAGE.SIMILARITY_VECTOR,
      status: vectors[0] ? 'complete' : 'failed',
      detail: vectors[0]
        ? `Best: pHash ${vectors[0].scores.perceptualBlend}% · structural ${vectors[0].scores.structural}% · ORB ${vectors[0].scores.orb}%`
        : 'Empty vector',
    });

    const topVector = vectors[0] ?? null;
    const secondVector = vectors[1] ?? null;

    // ═══ Stage 5 — 15-layer DNA compare on Top N ════════════════════════════
    let deepCompareResults = await deepVaultCompareService.compareTopCandidates(
      buffer, mimeType, originalName, sizeBytes, candidates, ownerUserId,
      pinitIdentificationConfig.deepCompareTopN,
    );
    const bestDeep = deepCompareResults[0] ?? null;
    const dna15Score = bestDeep?.overallConfidenceScore ?? 0;

    stages.push({
      stage: STAGE.DEEP_COMPARE,
      status: bestDeep ? 'complete' : 'skipped',
      detail: bestDeep
        ? `15-layer compare: ${bestDeep.overallConfidenceScore}% (${bestDeep.classification}) · ${bestDeep.matchedLayerCount}/${bestDeep.totalLayers} layers`
        : 'No deep compare',
    });

    // Select winning vault record — priority: identity hit > vector top > deep compare
    let match: VaultMatchResult | null = identityHit;

    if (!match && topVector && topVector.scores.composite >= 55) {
      match = vaultCandidateRankingService.toVaultMatch(candidates[0]!);
    }

    if (!match && bestDeep && bestDeep.overallConfidenceScore >= 38) {
      match = {
        tier: 4,
        method: `15-layer DNA compare (${bestDeep.overallConfidenceScore}%)`,
        dnaRecordId: bestDeep.dnaRecordId,
        vaultId: bestDeep.vaultId,
        ownerUserId,
        confidence: String(bestDeep.overallConfidenceScore),
        visualSimilarity: bestDeep.overallConfidenceScore / 100,
      };
    }

    // Prefer vector winner when deep compare is weak but vector is strong (regression fix)
    if (topVector && match) {
      const matchScore = Number.parseInt(match.confidence, 10) || 0;
      if (topVector.scores.composite >= 82 && topVector.scores.composite > matchScore + 10) {
        match = vaultCandidateRankingService.toVaultMatch(candidates[0]!);
      }
    }

    if (match && !certificateId) {
      const cert = await prisma.certificate.findFirst({
        where: { dnaRecordId: match.dnaRecordId, status: 'ACTIVE' },
        orderBy: { issuedAt: 'desc' },
      });
      if (cert) {
        certificateId = cert.certificateId;
        const v = await certificateService.verify(cert.certificateId);
        certificateScore = v.valid ? 95 : 40;
      }
    }

    if (match && !ownerShortId) {
      const owner = await prisma.user.findUnique({
        where: { id: match.ownerUserId },
        select: { shortId: true },
      });
      ownerShortId = owner?.shortId ?? null;
    }

    // ═══ Stage 6 — Confidence fusion ════════════════════════════════════════
    const fusion = confidenceFusionEngine.fuse({
      watermarkScore,
      identityTokenScore: Math.max(identityTokenScore, ocrScore),
      manifestScore,
      certificateScore,
      sha256Score,
      dna15LayerScore: dna15Score,
      perceptualHashScore: topVector?.scores.perceptualBlend ?? 0,
      structuralScore: topVector?.scores.structural ?? 0,
      semanticScore: topVector?.scores.clip ?? 0,
      localFeatureScore: topVector?.scores.orb ?? 0,
      ocrScore,
      candidate: candidates[0] ?? null,
      match,
      vaultVectorComposite: topVector?.scores.composite,
    });

    stages.push({
      stage: STAGE.FUSION,
      status: fusion.ownershipConfidence >= pinitIdentificationConfig.identifyThreshold ? 'complete' : 'partial',
      detail: `Ownership ${fusion.ownershipConfidence}% · identity ${fusion.identityConfidence}% · mode ${fusion.fusionMode}`,
    });

    // ═══ Stage 7 — Decision (never guess) ═══════════════════════════════════
    const margin = (topVector?.scores.composite ?? 0) - (secondVector?.scores.composite ?? 0);
    const hasForensicAnchor =
      sha256Score === 100
      || identityTokenScore >= 50
      || watermarkScore >= 50
      || manifestScore >= 50
      || ocrScore >= 65
      || (topVector?.scores.orb ?? 0) >= 55
      || (topVector?.scores.perceptualBlend ?? 0) >= 58
      || (topVector?.scores.structural ?? 0) >= 62
      || dna15Score >= 42;

    const filenameOnly = candidates[0]?.signals.length === 0
      && !hasForensicAnchor;

    const ambiguous = margin < 4
      && fusion.ownershipConfidence < 92
      && sha256Score < 100
      && identityTokenScore < 70;

    const identified = !filenameOnly
      && !ambiguous
      && hasForensicAnchor
      && !!match
      && fusion.ownershipConfidence >= pinitIdentificationConfig.identifyThreshold;

    stages.push({
      stage: STAGE.DECISION,
      status: identified ? 'complete' : 'failed',
      detail: identified
        ? `PINIT Original Identified — ${fusion.ownershipConfidence}% confidence`
        : `No PINIT signature found — confidence ${fusion.ownershipConfidence}% (anchor=${hasForensicAnchor}, margin=${margin})`,
    });

    const tamperingSummary = bestDeep
      ? bestDeep.tamperingDetected
        ? `Tampering detected — ${bestDeep.classification} (${bestDeep.overallConfidenceScore}%)`
        : `Content verified — ${bestDeep.classification}`
      : identified ? 'Identified via vault similarity vector' : null;

    logger.info('[PinitOIR] Recovery complete', {
      identified,
      ownershipConfidence: fusion.ownershipConfidence,
      topVector: topVector?.scores.composite,
      dna15: dna15Score,
      vaultId: match?.vaultId?.slice(0, 8),
    });

    return {
      match: identified ? match : null,
      probableMatch: !identified && match ? match : null,
      candidates,
      fusion,
      stages,
      variantCount: variants.length,
      manifestRecovered,
      identityTokenRecovered,
      watermarkRecovered,
      identified,
      highConfidence: fusion.highConfidence,
      recoveredSignals,
      deepCompareResults,
      certificateId,
      ownerShortId,
      tamperingSummary,
      bestDeepCompare: bestDeep,
    };
  }
}

export const pinitOriginalIdentityRecoveryService = new PinitOriginalIdentityRecoveryService();
