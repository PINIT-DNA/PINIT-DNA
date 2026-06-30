/**
 * PINIT Enterprise Identification Engine — 12-stage exhaustive recovery.
 * Never stops when watermark fails; fuses all signals before declaring unknown.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { extractManifest } from '../identity/integrity-manifest.service';
import { verifyRecoveryToken, RECOVERY_TOKEN_PREFIX } from '../identity/recovery-token.service';
import { phase3WatermarkRecovery } from '../watermark/phase3-watermark-recovery.service';
import { certificateService } from '../certificates/certificate.service';
import { forensicImagePreprocessor } from './forensic-image-preprocessor.service';
import { vaultCandidateRankingService } from './vault-candidate-ranking.service';
import { vaultWideDnaSearchService } from './vault-wide-dna-search.service';
import { deepVaultCompareService, type DeepCompareResult } from './deep-vault-compare.service';
import { vaultAutoMatchService, type VaultMatchResult } from './vault-auto-match.service';
import { confidenceFusionEngine, type FusionResult } from './confidence-fusion-engine.service';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import { StructuralLayer } from '../layers/layer2.structural';
import { generateLightweightDna } from './lightweight-dna.service';
import { isCameraScanFileName, candidateHasVisualSignal, isTrustedVaultMatch } from './vault-match-validator.service';
import { pinitIdentificationConfig } from '../../config/pinit-identification';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';

export interface RecoveryStage {
  stage: string;
  status: 'complete' | 'partial' | 'failed' | 'skipped';
  detail: string;
}

export interface RecoveredIdentitySignal {
  stage: string;
  score: number;
  recovered: boolean;
  detail: string;
}

export interface PinitIdentificationResult {
  match: VaultMatchResult | null;
  probableMatch: VaultMatchResult | null;
  candidates: RankedVaultCandidate[];
  fusion: FusionResult;
  stages: RecoveryStage[];
  variantCount: number;
  manifestRecovered: boolean;
  identityTokenRecovered: boolean;
  watermarkRecovered: boolean;
  identified: boolean;
  recoveredSignals: RecoveredIdentitySignal[];
  deepCompareResults: DeepCompareResult[];
  certificateId: string | null;
  ownerShortId: string | null;
  tamperingSummary: string | null;
  bestDeepCompare: DeepCompareResult | null;
}

const STAGE = {
  PREPROCESS: 'image_preprocessing',
  WATERMARK: 'watermark_recovery',
  IDENTITY_TOKEN: 'identity_token',
  MANIFEST: 'manifest_recovery',
  CERTIFICATE: 'certificate_recovery',
  VISUAL: 'visual_fingerprint',
  PERCEPTUAL: 'perceptual_hash',
  STRUCTURAL: 'structural_fingerprint',
  SEMANTIC: 'semantic_fingerprint',
  LOCAL_FEATURES: 'local_features',
  VAULT_SEARCH: 'vault_dna_search',
  DEEP_COMPARE: 'deep_dna_compare',
  FUSION: 'confidence_fusion',
} as const;

export class PinitIdentificationEngine {
  private readonly perceptual = new PerceptualLayer();
  private readonly structural = new StructuralLayer();

  async identify(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
  ): Promise<PinitIdentificationResult> {
    const stages: RecoveryStage[] = [];
    const recoveredSignals: RecoveredIdentitySignal[] = [];
    const pushSignal = (stage: string, score: number, recovered: boolean, detail: string) => {
      recoveredSignals.push({ stage, score, recovered, detail });
    };

    const variants = await forensicImagePreprocessor.generateVariants(buffer, mimeType);
    stages.push({
      stage: STAGE.PREPROCESS,
      status: 'complete',
      detail: `${variants.length} forensic variant(s) — survives compression, crop, blur, screenshot`,
    });

    let watermarkScore = 0;
    let identityTokenScore = 0;
    let manifestScore = 0;
    let certificateScore = 0;
    let sha256Score = 0;
    let visualScore = 0;
    let perceptualScore = 0;
    let structuralScore = 0;
    let semanticScore = 0;
    let localFeatureScore = 0;
    let ocrScore = 0;

    let watermarkRecovered = false;
    let identityTokenRecovered = false;
    let manifestRecovered = false;

    let identityHit: VaultMatchResult | null = null;
    let certificateId: string | null = null;
    let ownerShortId: string | null = null;

    const uploadedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const exact = await prisma.dnaRecord.findFirst({
      where: { sha256Hash: uploadedHash, ownerUserId, vaultRecord: { isNot: null } },
      include: { vaultRecord: true, ownerUser: { select: { shortId: true } } },
    });
    if (exact?.vaultRecord) {
      sha256Score = 100;
      identityHit = {
        tier: 1,
        method: 'SHA-256 exact hash',
        dnaRecordId: exact.id,
        vaultId: exact.vaultRecord.id,
        ownerUserId: exact.ownerUserId ?? ownerUserId,
        confidence: 'EXACT',
      };
      ownerShortId = exact.ownerUser?.shortId ?? null;
      pushSignal(STAGE.PREPROCESS, 100, true, 'Byte-exact vault match');
    }

    // ── Stage 1: Watermark (all variants — never stop) ───────────────────────
    for (const variant of variants) {
      try {
        const wm = await phase3WatermarkRecovery.recoverForensic(variant.buffer, variant.mimeType, ownerUserId);
        if (wm.recovered) {
          watermarkRecovered = true;
          watermarkScore = Math.max(watermarkScore, wm.tokenValid ? 94 : 72);
          pushSignal(STAGE.WATERMARK, watermarkScore, true, `${wm.detail} (${variant.label})`);
          if (!identityHit && wm.vaultId && wm.dnaRecordId) {
            identityHit = {
              tier: 2,
              method: `Invisible watermark (${variant.label})`,
              dnaRecordId: wm.dnaRecordId,
              vaultId: wm.vaultId,
              ownerUserId: wm.ownerUserId ?? ownerUserId,
              confidence: wm.tokenValid ? 'HIGH' : 'MEDIUM',
            };
          }
        }
      } catch { /* continue */ }
    }
    if (!watermarkRecovered) {
      stages.push({ stage: STAGE.WATERMARK, status: 'failed', detail: 'Watermark not recovered — continuing' });
      pushSignal(STAGE.WATERMARK, 0, false, 'No watermark on any variant');
    } else {
      stages.push({ stage: STAGE.WATERMARK, status: 'complete', detail: `Best score ${watermarkScore}%` });
    }

    // ── Stage 2: Identity token + embedded signature ─────────────────────────
    for (const variant of variants) {
      const latin = variant.buffer.toString('latin1');
      const rvtIdx = latin.indexOf(RECOVERY_TOKEN_PREFIX);
      if (rvtIdx >= 0) {
        const slice = latin.slice(rvtIdx, rvtIdx + 800);
        const verified = verifyRecoveryToken(slice);
        if (verified.valid && verified.payload?.ownerUserId === ownerUserId) {
          identityTokenRecovered = true;
          identityTokenScore = Math.max(identityTokenScore, 88);
          pushSignal(STAGE.IDENTITY_TOKEN, identityTokenScore, true, verified.detail);
          if (!identityHit) {
            identityHit = {
              tier: 2,
              method: `Recovery token (${variant.label})`,
              dnaRecordId: verified.payload.dnaRecordId,
              vaultId: verified.payload.vaultId,
              ownerUserId: verified.payload.ownerUserId,
              confidence: 'HIGH',
            };
          }
        }
      }

      try {
        const id = await identityEmbeddingService.extractLoose(variant.buffer, variant.mimeType, originalName);
        if (id.found && id.dnaId && id.vaultId) {
          const dnaRec = await prisma.dnaRecord.findUnique({
            where: { id: id.dnaId },
            select: { ownerUserId: true, ownerUser: { select: { shortId: true } } },
          });
          if (dnaRec?.ownerUserId === ownerUserId) {
            identityTokenRecovered = true;
            const sc = id.valid ? 95 : 68;
            identityTokenScore = Math.max(identityTokenScore, sc);
            pushSignal(STAGE.IDENTITY_TOKEN, sc, true, `Embedded signature (${variant.label})`);
            ownerShortId = dnaRec.ownerUser?.shortId ?? ownerShortId;
            if (!identityHit) {
              identityHit = {
                tier: 2,
                method: `Embedded identity (${variant.label})`,
                dnaRecordId: id.dnaId,
                vaultId: id.vaultId,
                ownerUserId: id.ownerUserId ?? ownerUserId,
                confidence: id.valid ? 'HIGH' : 'MEDIUM',
              };
            }
          }
        }
      } catch { /* continue */ }
    }
    if (!identityTokenRecovered) {
      stages.push({ stage: STAGE.IDENTITY_TOKEN, status: 'failed', detail: 'No identity token — continuing' });
    } else {
      stages.push({ stage: STAGE.IDENTITY_TOKEN, status: 'complete', detail: `Best score ${identityTokenScore}%` });
    }

    // ── Stage 3: Manifest ────────────────────────────────────────────────────
    for (const variant of variants) {
      const manifest = extractManifest(variant.buffer);
      if (manifest?.ownerUserId === ownerUserId && manifest.vaultId) {
        const vaultOk = await prisma.vaultRecord.findUnique({ where: { id: manifest.vaultId } });
        if (vaultOk) {
          manifestRecovered = true;
          manifestScore = Math.max(manifestScore, 92);
          pushSignal(STAGE.MANIFEST, manifestScore, true, `Integrity manifest (${variant.label})`);
          if (!identityHit) {
            identityHit = {
              tier: 2,
              method: `Integrity manifest (${variant.label})`,
              dnaRecordId: manifest.dnaRecordId,
              vaultId: manifest.vaultId,
              ownerUserId: manifest.ownerUserId,
              confidence: 'HIGH',
            };
          }
        }
      }
    }
    stages.push({
      stage: STAGE.MANIFEST,
      status: manifestRecovered ? 'complete' : 'failed',
      detail: manifestRecovered ? `Manifest score ${manifestScore}%` : 'No signed manifest — continuing',
    });

    // ── Stage 4: Certificate ─────────────────────────────────────────────────
    const certDnaId = identityHit?.dnaRecordId;
    if (certDnaId) {
      const cert = await prisma.certificate.findFirst({
        where: { dnaRecordId: certDnaId, status: 'ACTIVE' },
        orderBy: { issuedAt: 'desc' },
      });
      if (cert) {
        const v = await certificateService.verify(cert.certificateId);
        certificateId = cert.certificateId;
        certificateScore = v.valid ? 95 : 40;
        stages.push({
          stage: STAGE.CERTIFICATE,
          status: v.valid ? 'complete' : 'partial',
          detail: v.detail,
        });
        pushSignal(STAGE.CERTIFICATE, certificateScore, v.valid, v.detail);
      } else {
        stages.push({ stage: STAGE.CERTIFICATE, status: 'skipped', detail: 'No active certificate' });
      }
    } else {
      stages.push({ stage: STAGE.CERTIFICATE, status: 'skipped', detail: 'No vault link yet' });
    }

    const isCamera = isCameraScanFileName(originalName);
    const phashThreshold = isCamera
      ? pinitIdentificationConfig.cameraPhashThreshold
      : pinitIdentificationConfig.standardPhashThreshold;

    // ── Stages 5–9: Fingerprints on best variant ───────────────────────────
    const probeVariant = variants.find((v) => v.label === 'normalized') ?? variants[0]!;
    if (probeVariant.mimeType.startsWith('image/')) {
      try {
        const lite = await generateLightweightDna(probeVariant.buffer, probeVariant.mimeType);
        visualScore = Math.max(visualScore, lite.pHash ? 78 : lite.sha256 ? 55 : 45);
        pushSignal(STAGE.VISUAL, visualScore, visualScore >= 50, `Lightweight DNA: ${lite.mediaProfile}`);
        stages.push({ stage: STAGE.VISUAL, status: visualScore >= 50 ? 'complete' : 'partial', detail: `Visual ${visualScore}%` });
      } catch {
        stages.push({ stage: STAGE.VISUAL, status: 'skipped', detail: 'Visual fingerprint skipped' });
      }

      try {
        const fp = await this.perceptual.computeFingerprints(probeVariant.buffer);
        perceptualScore = Math.max(perceptualScore, 70);
        pushSignal(STAGE.PERCEPTUAL, perceptualScore, true, `pHash probe ready (${fp.pHash64.slice(0, 8)}…)`);
        stages.push({ stage: STAGE.PERCEPTUAL, status: 'complete', detail: 'Perceptual hashes generated' });
      } catch {
        stages.push({ stage: STAGE.PERCEPTUAL, status: 'failed', detail: 'Perceptual hash failed' });
      }

      try {
        const sg = await this.structural.generate({
          filePath: '',
          buffer: probeVariant.buffer,
          originalName,
          mimeType: probeVariant.mimeType,
          sizeBytes,
        });
        if (sg.success) {
          structuralScore = Math.max(structuralScore, 75);
          pushSignal(STAGE.STRUCTURAL, structuralScore, true, 'Sobel edge structural fingerprint');
          stages.push({ stage: STAGE.STRUCTURAL, status: 'complete', detail: 'Structural fingerprint ready' });
        }
      } catch {
        stages.push({ stage: STAGE.STRUCTURAL, status: 'failed', detail: 'Structural fingerprint failed' });
      }
    }

    try {
      const query = originalName.replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ');
      const { aiService } = await import('../ai/ai-embeddings.service');
      const sem = await aiService.findSimilar(query, 10);
      if (sem.results[0]) {
        semanticScore = Math.round(sem.results[0].similarity * 100);
        pushSignal(STAGE.SEMANTIC, semanticScore, semanticScore >= 40, sem.results[0].filename);
      }
      stages.push({
        stage: STAGE.SEMANTIC,
        status: semanticScore >= 40 ? 'complete' : 'partial',
        detail: semanticScore ? `Semantic top ${semanticScore}%` : 'Semantic index offline or no hit',
      });
    } catch {
      stages.push({ stage: STAGE.SEMANTIC, status: 'skipped', detail: 'Semantic search unavailable' });
    }

    stages.push({
      stage: STAGE.LOCAL_FEATURES,
      status: 'partial',
      detail: 'ORB/AKAZE via vault-wide search (stage 10)',
    });

    // ── Stage 10: Search ALL vault DNA records ───────────────────────────────
    let candidates = await vaultWideDnaSearchService.searchAll(
      variants,
      originalName,
      sizeBytes,
      ownerUserId,
      { phashThreshold, relaxedVisual: isCamera, enableLocalFeatures: true },
    );

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
            existing.signals = [...new Set([...existing.signals, ...c.signals])];
          } else {
            candidates.push({ ...c, signals: [...c.signals, `rank:${variant.label}`] });
          }
        }
      }
    }

    candidates = candidates
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    const localSig = candidates.find((c) => c.signals.some((s) => s.startsWith('local_features') || s === 'orb_akaze'));
    if (localSig) {
      localFeatureScore = localSig.compositeScore;
      pushSignal(STAGE.LOCAL_FEATURES, localFeatureScore, true, localSig.signals.join(', '));
      stages.push({ stage: STAGE.LOCAL_FEATURES, status: 'complete', detail: `Local features ${localFeatureScore}%` });
    }

    if (candidates[0]) {
      perceptualScore = Math.max(perceptualScore, candidates[0].signals.includes('perceptual_hash') ? candidates[0].compositeScore : 0);
      structuralScore = Math.max(structuralScore, candidates[0].signals.includes('structural_fingerprint') ? candidates[0].compositeScore : 0);
      semanticScore = Math.max(semanticScore, candidates.find((c) => c.signals.includes('semantic_dna'))?.compositeScore ?? 0);
    }

    stages.push({
      stage: STAGE.VAULT_SEARCH,
      status: candidates.length ? 'complete' : 'failed',
      detail: candidates.length
        ? `Searched all vault DNA — top ${candidates[0]!.compositeScore}% · ${candidates.length} candidates`
        : 'No vault candidates',
    });

    let match: VaultMatchResult | null = identityHit;
    if (!match) {
      match = vaultCandidateRankingService.selectBestCandidate(
        candidates,
        pinitIdentificationConfig.identifyThreshold,
      );
    }

    if (!match) {
      for (const variant of variants) {
        const m = await vaultAutoMatchService.findMatch(
          variant.buffer,
          variant.mimeType,
          originalName,
          sizeBytes,
          ownerUserId,
          { phashThreshold: isCamera ? 0.52 : 0.68 },
        );
        if (m && isTrustedVaultMatch(m)) {
          match = { ...m, method: `${m.method} (${variant.label})` };
          break;
        }
      }
    }

    // ── Stage 11: Deep 15-layer DNA compare ────────────────────────────────
    let deepCompareResults: DeepCompareResult[] = [];
    if (candidates.length && mimeType.startsWith('image/')) {
      deepCompareResults = await deepVaultCompareService.compareTopCandidates(
        buffer,
        mimeType,
        originalName,
        sizeBytes,
        candidates,
        ownerUserId,
        pinitIdentificationConfig.deepCompareTopN,
      );
      stages.push({
        stage: STAGE.DEEP_COMPARE,
        status: deepCompareResults.length ? 'complete' : 'failed',
        detail: deepCompareResults.length
          ? `Best deep compare ${deepCompareResults[0]!.overallConfidenceScore}% (${deepCompareResults[0]!.classification})`
          : 'Deep compare unavailable',
      });

      const bestDeep = deepCompareResults[0];
      if (bestDeep && bestDeep.overallConfidenceScore >= 40) {
        const deepCandidate = candidates.find((c) => c.dnaRecordId === bestDeep.dnaRecordId);
        if (!match || bestDeep.overallConfidenceScore > (parseInt(match.confidence, 10) || 0)) {
          match = {
            tier: 4,
            method: `15-layer DNA compare (${bestDeep.overallConfidenceScore}% — ${bestDeep.matchedLayerCount}/${bestDeep.totalLayers} layers)`,
            dnaRecordId: bestDeep.dnaRecordId,
            vaultId: bestDeep.vaultId,
            ownerUserId,
            confidence: String(bestDeep.overallConfidenceScore),
            visualSimilarity: bestDeep.overallConfidenceScore / 100,
          };
        }
        if (deepCandidate) {
          deepCandidate.dnaMatchPercent = bestDeep.overallConfidenceScore;
          deepCandidate.selected = true;
        }
      }
    } else {
      stages.push({ stage: STAGE.DEEP_COMPARE, status: 'skipped', detail: 'No candidates or non-image' });
    }

    const bestCandidate = candidates[0] ?? null;
    const probableCandidate = bestCandidate
      && bestCandidate.compositeScore >= pinitIdentificationConfig.identifyThreshold
      && candidateHasVisualSignal(bestCandidate)
      ? bestCandidate
      : null;

    const probableMatch = !match && probableCandidate
      ? vaultCandidateRankingService.toVaultMatch(probableCandidate)
      : null;

    const effectiveMatch = match ?? probableMatch;
    const bestDeepCompare = deepCompareResults[0] ?? null;

    if (effectiveMatch && !ownerShortId) {
      const owner = await prisma.user.findUnique({
        where: { id: effectiveMatch.ownerUserId },
        select: { shortId: true },
      });
      ownerShortId = owner?.shortId ?? null;
    }

    if (effectiveMatch && !certificateId) {
      const cert = await prisma.certificate.findFirst({
        where: { dnaRecordId: effectiveMatch.dnaRecordId, status: 'ACTIVE' },
        orderBy: { issuedAt: 'desc' },
      });
      certificateId = cert?.certificateId ?? null;
      if (cert) {
        const v = await certificateService.verify(cert.certificateId);
        certificateScore = Math.max(certificateScore, v.valid ? 95 : 40);
      }
    }

    const fusion = confidenceFusionEngine.fuse({
      watermarkScore,
      identityTokenScore,
      manifestScore,
      certificateScore,
      sha256Score,
      visualDnaScore: Math.max(visualScore, bestCandidate?.compositeScore ?? 0),
      perceptualHashScore: Math.max(perceptualScore, bestCandidate?.compositeScore ?? 0),
      structuralScore: Math.max(structuralScore, bestCandidate?.compositeScore ?? 0),
      semanticScore,
      localFeatureScore,
      textureScore: Math.max(visualScore, bestCandidate?.compositeScore ?? 0) * 0.92,
      ocrScore,
      candidate: bestCandidate,
      match: effectiveMatch,
    });

    stages.push({
      stage: STAGE.FUSION,
      status: fusion.ownershipConfidence >= pinitIdentificationConfig.identifyThreshold ? 'complete' : 'partial',
      detail: `Ownership confidence ${fusion.ownershipConfidence}% · identity ${fusion.identityConfidence}%`,
    });

    const identified = fusion.ownershipConfidence >= pinitIdentificationConfig.identifyThreshold
      && !!effectiveMatch;

    const tamperingSummary = bestDeepCompare
      ? bestDeepCompare.tamperingDetected
        ? `Tampering detected — ${bestDeepCompare.classification} (${bestDeepCompare.overallConfidenceScore}%)`
        : `Content verified — ${bestDeepCompare.classification}`
      : effectiveMatch ? 'Identity signals recovered — deep compare pending' : null;

    logger.info('[PinitIdentification] Complete', {
      identified,
      ownershipConfidence: fusion.ownershipConfidence,
      matchTier: effectiveMatch?.tier,
      deepBest: bestDeepCompare?.overallConfidenceScore,
    });

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
      identified,
      recoveredSignals,
      deepCompareResults,
      certificateId,
      ownerShortId,
      tamperingSummary,
      bestDeepCompare,
    };
  }
}

export const pinitIdentificationEngine = new PinitIdentificationEngine();
