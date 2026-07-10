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
import { forensicScannerService } from './forensic-scanner.service';
import { vaultSimilarityVectorService } from './vault-similarity-vector.service';
import { enterpriseRetrievalEngine } from './enterprise-retrieval-engine.service';
import type { LocalDnaSearchHit } from './vault-local-dna-search.service';
import { localDnaConfig } from '../../config/local-dna';
import { deepVaultCompareService } from './deep-vault-compare.service';
import { confidenceFusionEngine, FORENSIC_VERDICT_LABELS } from './confidence-fusion-engine.service';
import { REPORT_STATE_LABELS } from './investigation-decision-resolver.service';
import { pinitIdentificationConfig } from '../../config/pinit-identification';
import { investigationPerformanceConfig, clampCandidatePool } from '../../config/investigation-performance';
import { runParallelForensicRecovery } from './parallel-forensic-recovery.service';
import { createStageTimer, type StageTimer } from '../../lib/stage-timer';
import { withTimeoutSoft, withTimeoutSoftRetain } from '../../lib/safe-runner';
import type { InvestigationProgressEvent, InvestigationLiveSnapshot } from '../../types/unified-investigation.types';
import { mergeSnapshot } from './investigation-live-snapshot';
import type { VaultMatchResult } from './vault-auto-match.service';
import type {
  PinitIdentificationResult,
  RecoveryStage,
  RecoveredIdentitySignal,
} from './pinit-identification-engine.service';
import {
  logVaultRecordsLoaded,
  logVectorScores,
} from './investigation-pipeline-audit.service';
import type { RetrievalSelectionStep } from '../../types/investigation-pipeline-audit.types';
import type { AuthoritativeAsset } from '../../types/authoritative-asset.types';
import {
  buildAuthoritativeAsset,
  buildMediaDeepCandidates,
  selectAuthoritativeMatch,
} from './authoritative-asset.service';
import { resolveMediaProfile } from './adaptive-scoring.service';
import { isCameraScanFileName } from './vault-match-validator.service';
import {
  LOCAL_PATCH_RESCUE_MIN,
  RANKING_TOP_DEEP,
  RANKING_TRUSTED_LEAD_MIN,
  selectWinnerByRanking,
  stageCandidates,
  type CandidateRankingLog,
} from './candidate-ranking-engine.service';

function logCandidateStage(
  stage: string,
  candidate: VaultMatchResult | null,
  fusion?: { retrievalConfidence: number; identityConfidence: number; ownershipVerificationConfidence: number; forensicVerdict: string },
  extra?: Record<string, unknown>,
): void {
  logger.info(`[PinitOIR:${stage}]`, {
    vaultId: candidate?.vaultId?.slice(0, 8) ?? null,
    dnaRecordId: candidate?.dnaRecordId?.slice(0, 8) ?? null,
    ownerUserId: candidate?.ownerUserId?.slice(0, 8) ?? null,
    retrievalConfidence: fusion?.retrievalConfidence,
    identityRecovery: fusion?.identityConfidence,
    ownershipVerification: fusion?.ownershipVerificationConfidence,
    forensicVerdict: fusion?.forensicVerdict,
    ...extra,
  });
}

async function loadVaultOwnerSnapshot(
  vaultId: string,
  _dnaRecordId?: string,
): Promise<Pick<InvestigationLiveSnapshot, 'ownerName' | 'ownerPinitId' | 'originalFilename'>> {
  const vaultRow = await prisma.vaultRecord.findUnique({
    where: { id: vaultId },
    select: {
      originalFileName: true,
      dnaRecord: {
        select: {
          imageFilename: true,
          ownerUser: { select: { fullName: true, shortId: true } },
        },
      },
    },
  });
  const dna = vaultRow?.dnaRecord;
  return {
    ownerName: dna?.ownerUser?.fullName ?? undefined,
    ownerPinitId: dna?.ownerUser?.shortId ?? undefined,
    originalFilename: dna?.imageFilename ?? vaultRow?.originalFileName ?? undefined,
  };
}

export interface RecoveryOptions {
  /** Skip slow EphemeralFingerprinter (15-layer probe) — use for Unified Investigation */
  skipProbeDna?: boolean;
  /** Fewer image variants for faster scans */
  fastVariants?: boolean;
  /** ORB refine top-K vault candidates */
  orbTopK?: number;
  /** Unified Investigation — uses full retrieval when retrievalMode is set */
  investigationMode?: boolean;
  /** Full enterprise retrieval (multi-variant + multi-scale patch voting) */
  retrievalMode?: boolean;
  /** Cap 15-layer deep compare candidates */
  deepCompareTopN?: number;
  /** Two-stage retrieval: fast DB filter → scoped patch/ORB/deep compare */
  twoStageRetrieval?: boolean;
  /** Max vault candidates for stage-2 heavy retrieval */
  candidatePoolSize?: number;
  /** Progress callback for streaming investigation UI */
  onProgress?: (event: InvestigationProgressEvent) => void;
  /** Internal stage timer */
  stageTimer?: StageTimer;
}

const STAGE = {
  FORENSIC: 'stage1_forensic_recovery',
  PROBE_DNA: 'stage2_probe_dna',
  FORENSIC_SCAN: 'stage2b_forensic_scanner',
  VAULT_SEARCH: 'stage3_vault_search',
  LOCAL_DNA: 'stage3b_local_dna_index',
  SIMILARITY_VECTOR: 'stage4_similarity_vector',
  DEEP_COMPARE: 'stage5_deep_dna_compare',
  FUSION: 'stage6_confidence_fusion',
  DECISION: 'stage7_decision',
} as const;

export class PinitOriginalIdentityRecoveryService {
  private readonly probeFingerprinter = new EphemeralFingerprinter();

  /** Instant path when probe bytes match a vaulted DNA record exactly */
  private async tryExactHashFastPath(
    buffer: Buffer,
    _mimeType: string,
    _originalName: string,
    _sizeBytes: number,
    ownerUserId: string,
  ): Promise<PinitIdentificationResult | null> {
    const uploadedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const exact = await prisma.dnaRecord.findFirst({
      where: { sha256Hash: uploadedHash, ownerUserId, vaultRecord: { isNot: null } },
      include: { vaultRecord: true, ownerUser: { select: { shortId: true } } },
    });
    if (!exact?.vaultRecord) return null;

    const match: VaultMatchResult = {
      tier: 1,
      method: 'SHA-256 exact hash',
      dnaRecordId: exact.id,
      vaultId: exact.vaultRecord.id,
      ownerUserId: exact.ownerUserId ?? ownerUserId,
      confidence: 'EXACT',
    };

    const fusion = confidenceFusionEngine.fuse({
      sha256Score: 100,
      dna15LayerScore: 100,
      watermarkScore: 0,
      identityTokenScore: 0,
      match,
      vaultVectorComposite: 100,
    });

    const stages: RecoveryStage[] = [
      { stage: STAGE.FORENSIC, status: 'complete', detail: 'SHA-256 exact — forensic skipped' },
      { stage: STAGE.PROBE_DNA, status: 'skipped', detail: 'Exact hash fast path' },
      { stage: STAGE.LOCAL_DNA, status: 'skipped', detail: 'Exact hash fast path' },
      { stage: STAGE.VAULT_SEARCH, status: 'complete', detail: `Exact match ${exact.imageFilename}` },
      { stage: STAGE.SIMILARITY_VECTOR, status: 'complete', detail: '100% cryptographic match' },
      { stage: STAGE.DEEP_COMPARE, status: 'skipped', detail: 'Exact hash — compare skipped' },
      { stage: STAGE.FUSION, status: 'complete', detail: `Retrieval ${fusion.retrievalConfidence}% · identity ${fusion.identityConfidence}% · ownership ${fusion.ownershipVerificationConfidence}%` },
      { stage: STAGE.DECISION, status: 'complete', detail: `${FORENSIC_VERDICT_LABELS[fusion.forensicVerdict]} — retrieval ${fusion.retrievalConfidence}%` },
    ];

    const candidates = vaultSimilarityVectorService.toRankedCandidates([{
      vaultId: match.vaultId,
      dnaRecordId: match.dnaRecordId,
      ownerUserId: match.ownerUserId,
      filename: exact.imageFilename,
      scores: {
        sha256: 100, pHash: 100, aHash: 100, dHash: 100, perceptualBlend: 100,
        structural: 100, semanticColor: 100, clip: 100, orb: 100, aspectRatio: 100, composite: 100,
      },
      signals: ['cryptographic_hash'],
    }]);

    logger.info('[PinitOIR] Exact hash fast path', { dnaRecordId: exact.id.slice(0, 8) });

    const authoritativeAsset = await buildAuthoritativeAsset({
      selection: { match, source: 'sha256_exact' },
      candidates,
      vectors: [{
        vaultId: match.vaultId,
        dnaRecordId: match.dnaRecordId,
        ownerUserId: match.ownerUserId,
        filename: exact.imageFilename,
        scores: {
          sha256: 100, pHash: 100, aHash: 100, dHash: 100, perceptualBlend: 100,
          structural: 100, semanticColor: 100, clip: 100, orb: 100, aspectRatio: 100, composite: 100,
        },
        signals: ['cryptographic_hash'],
      }],
      deepCompareResults: [],
      localDnaHit: null,
      ownerUserId: exact.ownerUserId ?? ownerUserId,
    });

    let certificateScore = 0;
    if (authoritativeAsset.certificateId) {
      const v = await certificateService.verify(authoritativeAsset.certificateId);
      certificateScore = v.valid ? 95 : 40;
    }

    const fusionWithCert = confidenceFusionEngine.fuse({
      sha256Score: 100,
      dna15LayerScore: 100,
      certificateScore,
      watermarkScore: 0,
      identityTokenScore: 0,
      match,
      candidate: candidates[0] ?? null,
      vaultVectorComposite: 100,
    });

    return {
      match,
      probableMatch: null,
      verifiedCandidate: match,
      bestCandidate: match,
      authoritativeAsset,
      reportState: 'VERIFIED' as const,
      reportStateReason: 'SHA-256 exact hash match',
      candidates,
      fusion: fusionWithCert,
      stages,
      variantCount: 1,
      manifestRecovered: false,
      identityTokenRecovered: false,
      watermarkRecovered: false,
      identified: true,
      highConfidence: fusionWithCert.highConfidence,
      recoveredSignals: [{ stage: STAGE.FORENSIC, score: 100, recovered: true, detail: 'SHA-256 exact' }],
      deepCompareResults: [],
      certificateId: authoritativeAsset.certificateId,
      ownerShortId: authoritativeAsset.ownerPinitId,
      tamperingSummary: 'Byte-identical to vault original',
      bestDeepCompare: null,
      auditContext: {
        vectors: [{
          vaultId: match.vaultId,
          dnaRecordId: match.dnaRecordId,
          ownerUserId: match.ownerUserId,
          filename: exact.imageFilename,
          scores: {
            sha256: 100, pHash: 100, aHash: 100, dHash: 100, perceptualBlend: 100,
            structural: 100, semanticColor: 100, clip: 100, orb: 100, aspectRatio: 100, composite: 100,
          },
          signals: ['cryptographic_hash'],
        }],
        vaultRecordIds: [match.vaultId],
        selectionSteps: [{ stage: 'sha256_exact', vaultId: match.vaultId, dnaRecordId: match.dnaRecordId, detail: 'Exact hash fast path' }],
        identityHit: match,
        localDnaHit: null,
      },
    };
  }

  async recover(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
    options?: RecoveryOptions,
  ): Promise<PinitIdentificationResult> {
    const fastExact = await this.tryExactHashFastPath(buffer, mimeType, originalName, sizeBytes, ownerUserId);
    if (fastExact) return fastExact;

    const timer = options?.stageTimer ?? createStageTimer();
    const emit = (event: InvestigationProgressEvent) => options?.onProgress?.(event);
    let liveSnapshot: InvestigationLiveSnapshot | null = null;
    let earlyVaultShown = false;
    const emitPhase = (patch: Partial<InvestigationLiveSnapshot>) => {
      liveSnapshot = mergeSnapshot(liveSnapshot, patch);
      if (patch.vaultId) earlyVaultShown = true;
      emit({
        type: 'phase',
        stepId: `phase_${liveSnapshot.phase}`,
        label: `Phase ${liveSnapshot.phase}`,
        status: 'running',
        snapshot: liveSnapshot,
      });
    };
    const twoStage = options?.twoStageRetrieval === true;
    const poolSize = clampCandidatePool(options?.candidatePoolSize);
    const isVideoProbeEarly = resolveMediaProfile(mimeType, originalName) === 'video';
    const videoOriginalVariant = [{ label: 'original' as const, buffer, mimeType }];

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
    const selectionSteps: RetrievalSelectionStep[] = [];
    let vaultRecordIdsLoaded: string[] = [];

    const useFullRetrieval = !twoStage && (options?.retrievalMode || !options?.investigationMode);

    timer.start('preprocessing');
    emit({ type: 'timeline', stepId: 'preprocessing', label: 'Preprocessing', status: 'running' });

    const variants = isVideoProbeEarly
      ? videoOriginalVariant
      : await forensicImagePreprocessor.generateVariants(buffer, mimeType, {
        fast: twoStage || (options?.fastVariants && !useFullRetrieval),
        minimal: twoStage,
        scanner: twoStage ? false : pinitIdentificationConfig.phase5ScannerPipeline,
      });
    const forensicVariants = isVideoProbeEarly
      ? videoOriginalVariant
      : twoStage
        ? [{ label: 'original', buffer, mimeType }]
        : useFullRetrieval
          ? variants
          : options?.investigationMode
            ? [{ label: 'original', buffer, mimeType }]
            : options?.fastVariants
              ? variants.filter((v) => v.label === 'original' || v.label === 'normalized')
              : variants;

    const vectorVariants = isVideoProbeEarly
      ? videoOriginalVariant
      : twoStage
        ? variants.filter((v) => v.label === 'original' || v.label === 'normalized')
        : variants;

    timer.end('preprocessing', `${vectorVariants.length} variants`);
    emit({ type: 'timeline', stepId: 'preprocessing', label: 'Preprocessing', status: 'complete', elapsedMs: timer.getTimings().find((t) => t.stage === 'preprocessing')?.durationMs });

    // Early SHA-256 exact match — originals skip slow tampered-file pipeline
    const uploadedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const exactEarly = await prisma.dnaRecord.findFirst({
      where: { sha256Hash: uploadedHash, ownerUserId, vaultRecord: { isNot: null } },
      include: { vaultRecord: true, ownerUser: { select: { shortId: true, fullName: true } } },
    });
    if (exactEarly?.vaultRecord) {
      sha256Score = 100;
      identityHit = {
        tier: 1, method: 'SHA-256 exact hash',
        dnaRecordId: exactEarly.id, vaultId: exactEarly.vaultRecord.id,
        ownerUserId: exactEarly.ownerUserId ?? ownerUserId, confidence: 'EXACT',
      };
      ownerShortId = exactEarly.ownerUser?.shortId ?? ownerShortId;
      emitPhase({
        phase: 1,
        signatureFound: true,
        vaultId: identityHit.vaultId,
        dnaRecordId: identityHit.dnaRecordId,
        ownerName: exactEarly.ownerUser?.fullName ?? undefined,
        ownerPinitId: ownerShortId ?? undefined,
        originalFilename: exactEarly.imageFilename ?? undefined,
        confidence: 100,
        statusMessage: 'Exact vault match — verifying certificate…',
      });
    }

    let isExactVaultMatch = identityHit?.tier === 1 && sha256Score === 100;
    let fastVectors: Awaited<ReturnType<typeof vaultSimilarityVectorService.scoreEntireVault>> = [];

    // Enterprise forensic scanner — tile FAISS + multi-feature extraction
    let forensicScanResult: Awaited<ReturnType<typeof forensicScannerService.scanProbe>> | null = null;
    if (!isExactVaultMatch && mimeType.startsWith('image/') && !isVideoProbeEarly) {
      timer.start('forensic_scan');
      emit({ type: 'timeline', stepId: 'feature_extraction', label: 'Feature Extraction', status: 'running' });
      forensicScanResult = await withTimeoutSoft(
        () => forensicScannerService.scanProbe(buffer, mimeType),
        45_000,
        'forensic_scan',
      );
      timer.end('forensic_scan');
      if (forensicScanResult?.available) {
        const top = forensicScanResult.candidates[0];
        stages.push({
          stage: STAGE.FORENSIC_SCAN,
          status: top ? 'complete' : 'partial',
          detail: top
            ? `Tile FAISS: ${top.tileMatches} matches · ${forensicScanResult.overallConfidence}% confidence`
            : 'Forensic features extracted — no tile index hits yet',
        });
        emit({
          type: 'timeline',
          stepId: 'feature_extraction',
          label: 'Feature Extraction',
          status: top ? 'complete' : 'warning',
          detail: top
            ? `Top candidate ${top.vaultId.slice(0, 8)}… (${top.tileMatches} tile votes)`
            : 'Re-index vault images to populate tile FAISS',
        });
        if (top && top.confidence >= 55 && top.dnaRecordId && !identityHit) {
          identityHit = {
            tier: 3,
            method: `Forensic tile scanner (${top.tileMatches} tiles, ${top.visiblePercent ?? '?'}% visible)`,
            dnaRecordId: top.dnaRecordId,
            vaultId: top.vaultId,
            ownerUserId,
            confidence: String(top.confidence),
            visualSimilarity: top.confidence / 100,
          };
          push(STAGE.FORENSIC_SCAN, top.confidence, true, `Tile FAISS match — ${top.tileMatches} overlapping tiles`);
          const ownerSnap = await loadVaultOwnerSnapshot(top.vaultId, top.dnaRecordId);
          emitPhase({
            phase: 1,
            signatureFound: true,
            vaultId: top.vaultId,
            dnaRecordId: top.dnaRecordId,
            confidence: top.confidence,
            similarityScore: top.confidence / 100,
            statusMessage: 'Forensic tile match — verifying DNA…',
            ...ownerSnap,
          });
        }
      } else {
        stages.push({ stage: STAGE.FORENSIC_SCAN, status: 'skipped', detail: 'Python forensic scanner offline' });
        emit({ type: 'timeline', stepId: 'feature_extraction', label: 'Feature Extraction', status: 'skipped' });
      }
    }

    // ═══ Stage 1 — Forensic recovery (parallel in investigation two-stage mode) ═══
    timer.start('identity_recovery');
    emit({ type: 'timeline', stepId: 'identity_recovery', label: 'Identity Recovery', status: 'running' });

    if (twoStage && !isExactVaultMatch) {
      timer.start('vault_search');
      emit({ type: 'timeline', stepId: 'vault_search', label: 'Vault Search', status: 'running' });

      if (isVideoProbeEarly) {
        fastVectors = await vaultSimilarityVectorService.scoreEntireVault(
          buffer, mimeType, originalName, sizeBytes, ownerUserId, vectorVariants,
          { relaxedVisual: true, limit: poolSize, lightMode: true },
        );
        stages.push({
          stage: STAGE.FORENSIC,
          status: 'skipped',
          detail: 'Video probe — watermark/token/OCR skipped; partial keyframe recovery',
        });
        push(STAGE.FORENSIC, 0, false, 'Video investigation uses keyframe partial recovery');
      } else {
        const [parallel, fastVectorsResult] = await Promise.all([
          runParallelForensicRecovery(buffer, mimeType, originalName, ownerUserId, {
            skipOcr: investigationPerformanceConfig.skipInvestigationOcr,
            watermarkTimeoutMs: investigationPerformanceConfig.watermarkTimeoutMs,
            embeddingTimeoutMs: investigationPerformanceConfig.embeddingTimeoutMs,
          }),
          vaultSimilarityVectorService.scoreEntireVault(
            buffer, mimeType, originalName, sizeBytes, ownerUserId, vectorVariants,
            { relaxedVisual: true, skipOrb: true, limit: poolSize },
          ),
        ]);
        fastVectors = fastVectorsResult;

        watermarkRecovered = parallel.watermarkRecovered;
        identityTokenRecovered = parallel.identityTokenRecovered;
        manifestRecovered = parallel.manifestRecovered;
        watermarkScore = parallel.watermarkScore;
        identityTokenScore = parallel.identityTokenScore;
        manifestScore = parallel.manifestScore;
        ocrScore = parallel.ocrScore;
        if (!identityHit) identityHit = parallel.identityHit;
        for (const s of parallel.signals) {
          push(s.stage, s.score, s.recovered, s.detail);
        }
      }
      if (identityHit) {
        const [dnaRow, vaultRow, ownerRow] = await Promise.all([
          prisma.dnaRecord.findUnique({
            where: { id: identityHit.dnaRecordId },
            select: { imageFilename: true },
          }),
          prisma.vaultRecord.findUnique({
            where: { id: identityHit.vaultId },
            select: { originalFileName: true },
          }),
          prisma.user.findUnique({
            where: { id: identityHit.ownerUserId },
            select: { fullName: true, shortId: true },
          }),
        ]);
        const conf = Math.max(watermarkScore, identityTokenScore, manifestScore);
        emitPhase({
          phase: 1,
          signatureFound: true,
          vaultId: identityHit.vaultId,
          dnaRecordId: identityHit.dnaRecordId,
          ownerName: ownerRow?.fullName ?? undefined,
          ownerPinitId: ownerRow?.shortId ?? undefined,
          originalFilename: dnaRow?.imageFilename ?? vaultRow?.originalFileName ?? undefined,
          confidence: conf,
          watermarkStatus: watermarkRecovered ? 'DETECTED' : undefined,
          statusMessage: 'PINIT signature found — running deeper verification…',
        });
      } else {
        const topFastEarly = fastVectors[0];
        if (topFastEarly) {
          const ownerSnap = await loadVaultOwnerSnapshot(topFastEarly.vaultId, topFastEarly.dnaRecordId);
          emitPhase({
            phase: 1,
            signatureFound: true,
            vaultId: topFastEarly.vaultId,
            dnaRecordId: topFastEarly.dnaRecordId,
            confidence: topFastEarly.scores.composite,
            similarityScore: topFastEarly.scores.perceptualBlend,
            statusMessage: 'Possible vault match — verifying…',
            ...ownerSnap,
          });
        }
      }
    } else if (twoStage && isExactVaultMatch) {
      watermarkRecovered = true;
      watermarkScore = 100;
      push(STAGE.FORENSIC, 100, true, 'SHA-256 exact hash');
    } else for (const variant of forensicVariants) {
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

    timer.end('identity_recovery');
    emit({
      type: 'timeline',
      stepId: 'identity_recovery',
      label: 'Identity Recovery',
      status: watermarkRecovered || identityTokenRecovered || manifestRecovered ? 'complete' : 'warning',
      elapsedMs: timer.getTimings().find((t) => t.stage === 'identity_recovery')?.durationMs,
    });

    if (mimeType.startsWith('image/') && !options?.investigationMode && !twoStage) {
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

    if (!twoStage) {
      const uploadedHashLate = crypto.createHash('sha256').update(buffer).digest('hex');
      const exact = await prisma.dnaRecord.findFirst({
        where: { sha256Hash: uploadedHashLate, ownerUserId, vaultRecord: { isNot: null } },
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
      isExactVaultMatch = identityHit?.tier === 1 && sha256Score === 100;
    }

    // ═══ Stage 2 — Fresh 15-layer DNA on probe ════════════════════════════
    let probeLayerCount = 0;
    if (options?.skipProbeDna || twoStage) {
      stages.push({
        stage: STAGE.PROBE_DNA,
        status: 'skipped',
        detail: twoStage ? 'Lightweight DNA via fast filter (investigation)' : 'Probe DNA skipped (investigation fast path)',
      });
    } else {
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
    }

    // ═══ Two-stage retrieval: fast filter → scoped deep search ══════════════
    let candidateVaultIds: string[] = [];

    if (twoStage && !isExactVaultMatch && !fastVectors.length) {
      timer.start('vault_search');
      emit({ type: 'timeline', stepId: 'vault_search', label: 'Vault Search', status: 'running' });
      fastVectors = await vaultSimilarityVectorService.scoreEntireVault(
        buffer, mimeType, originalName, sizeBytes, ownerUserId, vectorVariants,
        { relaxedVisual: true, skipOrb: true, limit: poolSize },
      );
    } else if (twoStage && !isExactVaultMatch && fastVectors.length) {
      // vault_search already started during parallel identity recovery
    } else if (!twoStage) {
      timer.start('vault_search');
      emit({ type: 'timeline', stepId: 'vault_search', label: 'Vault Search', status: 'running' });
    }

    if (twoStage && !isExactVaultMatch) {
      candidateVaultIds = fastVectors.map((v) => v.vaultId);
      if (forensicScanResult?.candidates?.length) {
        for (const c of forensicScanResult.candidates.slice(0, 10)) {
          if (!candidateVaultIds.includes(c.vaultId)) {
            candidateVaultIds.unshift(c.vaultId);
          }
        }
        selectionSteps.push({
          stage: 'forensic_tile_faiss',
          detail: `${forensicScanResult.candidates.length} tile-FAISS candidates merged`,
        });
      }
      if (candidateVaultIds.length) {
        logVaultRecordsLoaded(ownerUserId, candidateVaultIds);
        selectionSteps.push({
          stage: 'fast_filter',
          detail: `${candidateVaultIds.length} vault records from fast vector filter`,
        });
      }
      if (identityHit?.vaultId && !candidateVaultIds.includes(identityHit.vaultId)) {
        candidateVaultIds.unshift(identityHit.vaultId);
      }
      candidateVaultIds = [...new Set(candidateVaultIds)].slice(0, poolSize);

      const hasStrongIdentityAnchor = !!(
        identityHit
        && (identityHit.tier <= 2 || watermarkRecovered || manifestRecovered || identityTokenRecovered)
      );
      if (hasStrongIdentityAnchor && identityHit) {
        const narrow = investigationPerformanceConfig.candidatePoolWithIdentity;
        candidateVaultIds = [
          identityHit.vaultId,
          ...candidateVaultIds.filter((id) => id !== identityHit!.vaultId),
        ].slice(0, narrow);
      }

      const topFast = fastVectors[0];
      const topComposite = topFast?.scores.composite ?? 0;
      // Only claim signature found on a strong visual lead — weak scores cause false locks.
      const strongLead = topComposite >= 50;
      if (topFast && !identityHit && !earlyVaultShown) {
        const ownerSnap = await loadVaultOwnerSnapshot(topFast.vaultId, topFast.dnaRecordId);
        // Always emit vaultId so timeout retention and live UI keep the lead.
        emitPhase({
          phase: 1,
          signatureFound: strongLead,
          vaultId: topFast.vaultId,
          dnaRecordId: topFast.dnaRecordId,
          confidence: topComposite,
          similarityScore: topFast.scores.perceptualBlend,
          statusMessage: strongLead
            ? 'Possible vault match — verifying…'
            : `Candidate found — verifying…`,
          ...ownerSnap,
        });
      } else if (topFast && identityHit) {
        emitPhase({
          phase: 1,
          signatureFound: true,
          vaultId: identityHit.vaultId,
          dnaRecordId: identityHit.dnaRecordId,
          confidence: Math.max(
            watermarkScore,
            identityTokenScore,
            manifestScore,
            topFast.scores.composite,
          ),
          similarityScore: topFast.scores.perceptualBlend,
        });
      }
    }

    timer.end('vault_search', twoStage ? `${candidateVaultIds.length} candidates` : undefined);
    emit({
      type: 'timeline',
      stepId: 'vault_search',
      label: 'Vault Search',
      status: 'complete',
      detail: twoStage ? `Fast filter → ${candidateVaultIds.length} candidates` : undefined,
      elapsedMs: timer.getTimings().find((t) => t.stage === 'vault_search')?.durationMs,
      partial: fastVectors[0]
        ? { vaultId: fastVectors[0].vaultId, ownershipConfidence: fastVectors[0].scores.composite, candidateCount: candidateVaultIds.length }
        : undefined,
    });

    // ═══ Stage 3b — Local DNA patch index search (scoped in two-stage) ═══
    let localDnaScore = 0;
    let localDnaHit: LocalDnaSearchHit | null = null;

    const hasStrongIdentityAnchor = !!(
      identityHit
      && (identityHit.tier <= 2 || watermarkRecovered || manifestRecovered || identityTokenRecovered)
    );
    // Only skip patch search on a trusted lead (≥50%). Modest leads (~30%) are often
    // wrong vaults on heavy crop/compress — local DNA is the fragment recovery path.
    const trustedVectorLead = (fastVectors[0]?.scores.composite ?? 0) >= RANKING_TRUSTED_LEAD_MIN;
    const skipLocalDna = (twoStage
      && hasStrongIdentityAnchor
      && investigationPerformanceConfig.skipLocalDnaWhenWatermark)
      || (twoStage && trustedVectorLead);

    if (skipLocalDna) {
      emit({
        type: 'timeline',
        stepId: 'orb_verification',
        label: 'ORB Verification',
        status: 'skipped',
        detail: trustedVectorLead && !hasStrongIdentityAnchor
          ? 'Skipped — trusted vector lead (deep DNA will verify)'
          : 'Skipped — vault already identified via watermark/token',
      });
      stages.push({
        stage: STAGE.LOCAL_DNA,
        status: 'skipped',
        detail: trustedVectorLead && !hasStrongIdentityAnchor
          ? `Trusted vector lead ${fastVectors[0]?.scores.composite}% — patch search skipped`
          : `Watermark/identity anchor — patch search skipped (${identityHit?.method ?? 'tier ≤2'})`,
      });
    } else if (localDnaConfig.enabled && mimeType.startsWith('image/') && !isExactVaultMatch) {
      timer.start('local_dna');
      emit({ type: 'timeline', stepId: 'orb_verification', label: 'ORB Verification', status: 'running' });

      const isCameraProbe = isCameraScanFileName(originalName);
      // Camera probes get a modest extra budget only when no live vault lead exists.
      const localDnaBudgetMs = isCameraProbe
        ? Math.max(investigationPerformanceConfig.localDnaTimeoutMs, 30_000)
        : investigationPerformanceConfig.localDnaTimeoutMs;

      const retrieval = await (twoStage
        ? withTimeoutSoft(
          () => enterpriseRetrievalEngine.retrieve(
            buffer, mimeType, ownerUserId,
            {
              skipOrbRefine: investigationPerformanceConfig.skipOrbInInvestigation,
              investigationFast: true,
              candidateVaultIds: candidateVaultIds.length ? candidateVaultIds : undefined,
              maxProbes: hasStrongIdentityAnchor ? 1 : investigationPerformanceConfig.maxInvestigationProbes,
              patchScales: [...investigationPerformanceConfig.investigationPatchScales],
            },
          ),
          localDnaBudgetMs,
          'local_dna_search',
        )
        : enterpriseRetrievalEngine.retrieve(
          buffer, mimeType, ownerUserId,
          { skipOrbRefine: false, fullVariants: useFullRetrieval },
        )) ?? { localDnaHits: [], retrievalConfidence: 0, probes: [], bestProbe: { label: 'original', buffer, mimeType }, topVaultId: null, totalPatchVotes: 0 };
      const localHits = retrieval.localDnaHits;
      localDnaHit = localHits[0] ?? null;
      localDnaScore = localDnaHit?.compositeScore ?? retrieval.retrievalConfidence;

      stages.push({
        stage: STAGE.LOCAL_DNA,
        status: localDnaHit ? 'complete' : 'partial',
        detail: localDnaHit
          ? `${localDnaHit.patchMatchCount} patch matches (${Math.round(localDnaHit.matchRatio * 100)}% of probe) · score ${localDnaScore}%`
          : 'No local patch matches — vault index may need backfill',
      });

      // Camera / heavy-tamper: lock identity from patch DNA at a lower bar when
      // global vector is weak (crops often false-lead on the wrong vault).
      const weakVectorLead = (fastVectors[0]?.scores.composite ?? 0) < RANKING_TRUSTED_LEAD_MIN;
      const identifyThreshold = isCameraProbe || weakVectorLead
        ? Math.min(localDnaConfig.identifyCompositeThreshold, LOCAL_PATCH_RESCUE_MIN)
        : localDnaConfig.identifyCompositeThreshold;

      if (localDnaHit && localDnaScore >= identifyThreshold && !identityHit) {
        identityHit = {
          tier: 3,
          method: `Local patch DNA (${localDnaHit.patchMatchCount} patches, ${Math.round(localDnaHit.matchRatio * 100)}% fragment)`,
          dnaRecordId: localDnaHit.dnaRecordId,
          vaultId: localDnaHit.vaultId,
          ownerUserId: localDnaHit.ownerUserId,
          confidence: String(localDnaScore),
          visualSimilarity: (localDnaHit.orbRefineScore || localDnaScore) / 100,
        };
        push(STAGE.LOCAL_DNA, localDnaScore, true, `Fragment recovery via ${localDnaHit.patchMatchCount} patch votes`);
      } else if (localDnaHit && localDnaScore >= 50) {
        push(STAGE.LOCAL_DNA, localDnaScore, true, `Partial fragment match — ${localDnaHit.patchMatchCount} patches`);
      }

      timer.end('local_dna');
      emit({
        type: 'timeline',
        stepId: 'orb_verification',
        label: 'ORB Verification',
        status: localDnaHit ? 'complete' : 'warning',
        elapsedMs: timer.getTimings().find((t) => t.stage === 'local_dna')?.durationMs,
      });
      if (localDnaHit) {
        const hadPriorPhase = earlyVaultShown;
        if (!hadPriorPhase) {
          const ownerSnap = await loadVaultOwnerSnapshot(localDnaHit.vaultId, localDnaHit.dnaRecordId);
          emitPhase({
            phase: 1,
            signatureFound: true,
            vaultId: localDnaHit.vaultId,
            dnaRecordId: localDnaHit.dnaRecordId,
            confidence: localDnaScore,
            statusMessage: 'PINIT patch DNA match — running deeper verification…',
            ...ownerSnap,
          });
        }
        emitPhase({
          phase: 2,
          signatureFound: true,
          vaultId: localDnaHit.vaultId,
          dnaRecordId: localDnaHit.dnaRecordId,
          patchVotes: localDnaHit.patchMatchCount,
          orbScore: localDnaHit.orbRefineScore || undefined,
          confidence: localDnaScore,
          statusMessage: `${localDnaHit.patchMatchCount} patch DNA matches verified`,
        });
      }
    } else {
      stages.push({
        stage: STAGE.LOCAL_DNA,
        status: 'skipped',
        detail: isExactVaultMatch
          ? 'SHA-256 exact match — patch search skipped'
          : 'Local DNA index disabled or non-image probe',
      });
    }

    // ═══ Stages 3–4 — Score vault (ORB on filtered pool in two-stage) ════════
    const orbTopK = isExactVaultMatch ? 0 : (options?.orbTopK ?? (twoStage ? investigationPerformanceConfig.orbRefineTopK : 15));
    let vectors: Awaited<ReturnType<typeof vaultSimilarityVectorService.scoreEntireVault>>;
    if (isExactVaultMatch && identityHit) {
      vectors = [{
        vaultId: identityHit.vaultId,
        dnaRecordId: identityHit.dnaRecordId,
        ownerUserId: identityHit.ownerUserId,
        filename: originalName,
        scores: {
          sha256: 100, pHash: 100, aHash: 100, dHash: 100, perceptualBlend: 100,
          structural: 100, semanticColor: 100, clip: 100, orb: 100, aspectRatio: 100, composite: 100,
        },
        signals: ['cryptographic_hash'],
      }];
    } else if (twoStage && candidateVaultIds.length) {
      // Trusted lead already scored — skip second full vault pass. Modest leads still
      // re-score so a wrong ~30% crop match can be displaced by better candidates.
      if (fastVectors.length && (fastVectors[0]?.scores.composite ?? 0) >= RANKING_TRUSTED_LEAD_MIN) {
        vectors = [...fastVectors];
      } else if (isVideoProbeEarly && fastVectors.length) {
        vectors = [...fastVectors];
        const topId = vectors[0]?.vaultId;
        if (topId && (vectors[0]?.scores.composite ?? 0) >= 28) {
          const refined = await vaultSimilarityVectorService.scoreEntireVault(
            buffer, mimeType, originalName, sizeBytes, ownerUserId, vectorVariants,
            { candidateVaultIds: [topId], limit: 1, lightMode: false },
          );
          if (refined[0]) vectors[0] = refined[0];
        }
      } else {
        const skipVectorOrb = hasStrongIdentityAnchor && investigationPerformanceConfig.skipVectorOrbWhenWatermark;
        vectors = await vaultSimilarityVectorService.scoreEntireVault(
          buffer, mimeType, originalName, sizeBytes, ownerUserId, vectorVariants,
          {
            relaxedVisual: true,
            candidateVaultIds,
            orbTopK: skipVectorOrb ? 0 : Math.min(3, orbTopK),
            skipOrb: skipVectorOrb,
            limit: poolSize,
          },
        );
      }
      const topVec = vectors[0];
      if (topVec && !localDnaHit && topVec.scores.composite >= 50) {
        emitPhase({
          phase: 2,
          signatureFound: true,
          vaultId: topVec.vaultId,
          similarityScore: topVec.scores.perceptualBlend,
          orbScore: topVec.scores.orb || undefined,
          confidence: topVec.scores.composite,
          statusMessage: 'Visual DNA similarity verified',
        });
      }
      for (const fv of fastVectors) {
        if (!vectors.find((v) => v.vaultId === fv.vaultId)) vectors.push(fv);
      }
      vectors.sort((a, b) => b.scores.composite - a.scores.composite);
    } else {
      vectors = await vaultSimilarityVectorService.scoreEntireVault(
        buffer, mimeType, originalName, sizeBytes, ownerUserId, variants,
        { relaxedVisual: true, orbTopK },
      );
    }
    let candidates = vaultSimilarityVectorService.toRankedCandidates(vectors);

    let partialVideoScore = 0;
    let partialVideoFrameRatio = 0;
    let partialVideoMatchedFrames = 0;

    if (isVideoProbeEarly && vectors[0]) {
      const topV = vectors[0];
      const frameSignal = topV.signals.find((s) => s.startsWith('matched_probe_frames:'));
      partialVideoMatchedFrames = frameSignal
        ? parseInt(frameSignal.split(':')[1] ?? '0', 10)
        : 0;
      partialVideoFrameRatio = topV.scores.aspectRatio / 100;
      partialVideoScore = topV.scores.composite;

      const hasPartialAnchor = topV.signals.includes('partial_video_recovery')
        || (partialVideoMatchedFrames >= 3 && partialVideoFrameRatio >= 0.35)
        || (partialVideoMatchedFrames >= 2 && topV.scores.composite >= 40);

      if (hasPartialAnchor && !identityHit) {
        identityHit = {
          tier: 3,
          method: `Partial video frame recovery (${Math.round(partialVideoFrameRatio * 100)}% probe frames, ${partialVideoMatchedFrames} matched)`,
          dnaRecordId: topV.dnaRecordId,
          vaultId: topV.vaultId,
          ownerUserId: topV.ownerUserId,
          confidence: topV.scores.composite >= 60 ? 'HIGH' : 'MEDIUM',
          visualSimilarity: partialVideoFrameRatio,
        };
        selectionSteps.push({
          stage: 'partial_video_recovery',
          vaultId: topV.vaultId,
          dnaRecordId: topV.dnaRecordId,
          detail: `Partial keyframe match — composite ${topV.scores.composite}% · frames ${partialVideoMatchedFrames}/${topV.scores.aspectRatio}%`,
        });
      }
    }

    // Promote local-DNA hit into candidate list for deep compare + fusion
    if (localDnaHit && localDnaScore >= LOCAL_PATCH_RESCUE_MIN) {
      const existing = candidates.find((c) => c.vaultId === localDnaHit!.vaultId);
      if (existing) {
        existing.compositeScore = Math.max(existing.compositeScore, localDnaScore);
        existing.signals = [...new Set([...existing.signals, ...localDnaHit.signals])];
        existing.method = existing.method || `Local patch DNA (${localDnaHit.patchMatchCount} patches)`;
      } else {
        candidates.unshift({
          rank: 0,
          dnaRecordId: localDnaHit.dnaRecordId,
          vaultId: localDnaHit.vaultId,
          ownerUserId: localDnaHit.ownerUserId,
          preliminaryScore: localDnaScore,
          compositeScore: localDnaScore,
          tier: 3,
          method: `Local patch DNA (${localDnaHit.patchMatchCount} patches)`,
          signals: localDnaHit.signals,
        });
      }
      candidates.sort((a, b) => b.compositeScore - a.compositeScore);
      candidates = candidates.map((c, i) => ({ ...c, rank: i + 1 }));
    }

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

    vaultRecordIdsLoaded = vectors.map((v) => v.vaultId);
    logVaultRecordsLoaded(ownerUserId, vaultRecordIdsLoaded);
    logVectorScores(vectors);
    selectionSteps.push({
      stage: 'vault_vector_scoring',
      detail: `${vectors.length} vault records scored — top composite ${topVector?.scores.composite ?? 0}%`,
    });
    if (identityHit) {
      selectionSteps.push({
        stage: 'identity_hit',
        vaultId: identityHit.vaultId,
        dnaRecordId: identityHit.dnaRecordId,
        detail: identityHit.method,
      });
    }
    if (localDnaHit) {
      selectionSteps.push({
        stage: 'local_patch_dna',
        vaultId: localDnaHit.vaultId,
        dnaRecordId: localDnaHit.dnaRecordId,
        detail: `patchVotes=${localDnaHit.patchMatchCount} score=${localDnaScore} orb=${localDnaHit.orbRefineScore ?? 0}`,
      });
    }

    // ═══ Stage 5 — Authoritative asset selection + 15-layer DNA on that vault only ═══
    let deepCompareResults: Awaited<ReturnType<typeof deepVaultCompareService.compareTopCandidates>> = [];
    let authoritativeAsset: AuthoritativeAsset | null = null;
    let dna15Score = isExactVaultMatch ? 100 : 0;
    let candidateRankingLogs: CandidateRankingLog[] = [];

    const preliminarySelection = selectAuthoritativeMatch({
      identityHit,
      candidates,
      localDnaHit,
      localDnaScore,
      deepCompare: null,
      isExactVaultMatch,
      ownerUserId,
    });

    selectionSteps.push({
      stage: 'authoritative_preselection',
      vaultId: preliminarySelection?.match.vaultId,
      dnaRecordId: preliminarySelection?.match.dnaRecordId,
      detail: preliminarySelection?.source ?? 'none',
    });

    const isImageProbe = resolveMediaProfile(mimeType, originalName) === 'image';

    // Images: never skip DNA on local-patch alone (false positives e.g. logo → portrait).
    // Video: may skip when SHA-256 exact.
    if (isExactVaultMatch && preliminarySelection) {
      stages.push({
        stage: STAGE.DEEP_COMPARE,
        status: 'skipped',
        detail: 'SHA-256 exact match — 15-layer compare skipped',
      });
      authoritativeAsset = await buildAuthoritativeAsset({
        selection: preliminarySelection,
        candidates,
        vectors,
        deepCompareResults: [],
        localDnaHit,
        ownerUserId,
      });
      dna15Score = 100;
      candidateRankingLogs = [{
        rank: 1,
        stage: 'acceptance',
        vaultId: preliminarySelection.match.vaultId,
        dnaRecordId: preliminarySelection.match.dnaRecordId,
        vectorSimilarity: 100,
        clipSimilarity: 100,
        orbScore: 100,
        pHashSimilarity: 100,
        dnaScore: 100,
        dnaClassification: 'DNA_MATCH',
        fusionScore: 100,
        acceptanceVerdict: 'VERIFIED_ORIGINAL',
        decision: 'ACCEPT',
        rejectReasons: [],
      }];
      emitPhase({
        phase: 3,
        deepVerificationRunning: false,
        signatureFound: true,
        vaultId: authoritativeAsset.vaultId,
        dnaRecordId: authoritativeAsset.dnaRecordId,
        originalFilename: authoritativeAsset.originalFilename,
        ownerPinitId: authoritativeAsset.ownerPinitId ?? undefined,
        confidence: 100,
        dnaMatchPercent: 100,
        statusMessage: 'Exact vault match verified',
      });
    } else {
      timer.start('deep_dna_compare');
      emit({ type: 'timeline', stepId: 'deep_dna_compare', label: 'Deep DNA Compare', status: 'running' });
      emitPhase({
        phase: 3,
        deepVerificationRunning: true,
        statusMessage: 'Running 15-layer forensic verification…',
      });

      // Phase 4 — Candidate Ranking Engine funnel (never stop at #1).
      const mediaKey = isImageProbe
        ? 'image'
        : resolveMediaProfile(mimeType, originalName) === 'video'
          ? 'video'
          : resolveMediaProfile(mimeType, originalName) === 'document'
            ? 'pdf'
            : undefined;

      let rankingPool = stageCandidates({
        candidates,
        identityHit,
        mediaType: mediaKey,
      });

      // Video/audio: merge media-aware deep candidates into the pool (adapters only).
      if (!isImageProbe) {
        const mediaDeep = buildMediaDeepCandidates(
          candidates,
          identityHit,
          preliminarySelection,
          originalName,
          vectors.map((v) => ({ vaultId: v.vaultId, filename: v.filename })),
        );
        const seen = new Set(rankingPool.map((c) => c.vaultId));
        for (const c of mediaDeep) {
          if (!seen.has(c.vaultId)) {
            rankingPool.push(c);
            seen.add(c.vaultId);
          }
        }
        rankingPool = rankingPool.slice(0, RANKING_TOP_DEEP);
      }

      // Per-candidate deep DNA — retain results that finish within grace (never discard completed evidence).
      const deepMs = investigationPerformanceConfig.deepCompareTimeoutMs;
      const ranking = await selectWinnerByRanking({
        candidates: rankingPool.length ? rankingPool : candidates,
        vectors,
        localDnaHit,
        localDnaScore,
        identityHit,
        isExactVaultMatch,
        mediaType: mediaKey,
        compareCandidate: async (c) => {
          const result = await withTimeoutSoftRetain(
            () => deepVaultCompareService.compareOneCandidate(
              buffer, mimeType, originalName, sizeBytes, c, ownerUserId,
            ),
            deepMs,
            12_000,
            `deep_compare_${c.vaultId.slice(0, 8)}`,
          );
          if (!result) {
            logger.warn('Deep compare timed out for candidate', {
              vaultId: c.vaultId,
              timeoutMs: deepMs,
            });
          }
          return result;
        },
      });
      candidateRankingLogs = ranking.logs;
      deepCompareResults = ranking.allDeepResults;

      selectionSteps.push({
        stage: 'candidate_ranking',
        detail: `funnel vector→identity→media→deep=${ranking.stages.afterDeepPool} evaluated=${ranking.stages.evaluated}`,
      });

      if (ranking.winner && ranking.source !== 'none') {
        authoritativeAsset = await buildAuthoritativeAsset({
          selection: { match: ranking.winner, source: ranking.source },
          candidates,
          vectors,
          deepCompareResults,
          localDnaHit,
          ownerUserId,
        });
        dna15Score = ranking.deepCompare?.overallConfidenceScore
          ?? authoritativeAsset.deepCompare?.overallConfidenceScore
          ?? 0;
        selectionSteps.push({
          stage: 'authoritative_asset_locked',
          vaultId: authoritativeAsset.vaultId,
          dnaRecordId: authoritativeAsset.dnaRecordId,
          certificateId: authoritativeAsset.certificateId,
          detail: `source=${authoritativeAsset.selectionSource} file=${authoritativeAsset.originalFilename} · ranking walk accepted`,
        });
      } else {
        // All candidates rejected — do not lock a weak vault or keep retrieval confidence.
        authoritativeAsset = null;
        dna15Score = 0;
        selectionSteps.push({
          stage: 'authoritative_asset_locked',
          detail: `all ${ranking.logs.length} candidates rejected by ranking + acceptance`,
        });
      }

      if (authoritativeAsset?.deepCompare) {
        emitPhase({
          phase: 3,
          deepVerificationRunning: false,
          signatureFound: true,
          vaultId: authoritativeAsset.vaultId,
          dnaRecordId: authoritativeAsset.dnaRecordId,
          originalFilename: authoritativeAsset.originalFilename,
          ownerPinitId: authoritativeAsset.ownerPinitId ?? undefined,
          dnaMatchPercent: authoritativeAsset.deepCompare.overallConfidenceScore,
          confidence: authoritativeAsset.deepCompare.overallConfidenceScore,
          statusMessage: `15-layer DNA: ${authoritativeAsset.deepCompare.overallConfidenceScore}% — ${authoritativeAsset.deepCompare.classification}`,
        });
      } else if (authoritativeAsset && !isImageProbe) {
        const vectorConf = authoritativeAsset.vector?.scores.composite
          ?? authoritativeAsset.rankedCandidate?.compositeScore
          ?? 30;
        emitPhase({
          phase: 3,
          deepVerificationRunning: false,
          signatureFound: true,
          vaultId: authoritativeAsset.vaultId,
          dnaRecordId: authoritativeAsset.dnaRecordId,
          originalFilename: authoritativeAsset.originalFilename,
          ownerPinitId: authoritativeAsset.ownerPinitId ?? undefined,
          confidence: vectorConf,
          dnaMatchPercent: vectorConf,
          statusMessage: `Vault match retained (${authoritativeAsset.selectionSource}) — deep DNA incomplete`,
        });
      } else {
        emitPhase({
          phase: 3,
          deepVerificationRunning: false,
          signatureFound: false,
          statusMessage: 'No vault candidate passed DNA / ORB / fusion gates',
        });
      }

      timer.end('deep_dna_compare');
      emit({
        type: 'timeline',
        stepId: 'deep_dna_compare',
        label: 'Deep DNA Compare',
        status: authoritativeAsset?.deepCompare ? 'complete' : authoritativeAsset ? 'warning' : 'failed',
        elapsedMs: timer.getTimings().find((t) => t.stage === 'deep_dna_compare')?.durationMs,
      });

      stages.push({
        stage: STAGE.DEEP_COMPARE,
        status: authoritativeAsset?.deepCompare ? 'complete' : authoritativeAsset ? 'partial' : 'failed',
        detail: authoritativeAsset?.deepCompare
          ? `15-layer compare: ${authoritativeAsset.deepCompare.overallConfidenceScore}% (${authoritativeAsset.deepCompare.classification}) · ${authoritativeAsset.deepCompare.matchedLayerCount}/${authoritativeAsset.deepCompare.totalLayers} layers`
          : authoritativeAsset
            ? `Deep DNA incomplete — retained ${authoritativeAsset.selectionSource} vault ${authoritativeAsset.vaultId.slice(0, 8)}…`
            : 'All candidates rejected after DNA / ORB / fusion gates',
      });
    }

    const assetVector = authoritativeAsset?.vector ?? null;
    const secondVector = authoritativeAsset
      ? vectors.find((v) => v.vaultId !== authoritativeAsset!.vaultId) ?? null
      : vectors[1] ?? null;
    const verifiedCandidate = authoritativeAsset?.match ?? null;

    certificateId = authoritativeAsset?.certificateId ?? null;
    if (authoritativeAsset?.certificateId) {
      const v = await certificateService.verify(authoritativeAsset.certificateId);
      certificateScore = v.valid ? 95 : 40;
      selectionSteps.push({
        stage: 'certificate_lookup',
        vaultId: authoritativeAsset.vaultId,
        dnaRecordId: authoritativeAsset.dnaRecordId,
        certificateId: authoritativeAsset.certificateId,
        detail: 'Certificate from authoritative asset',
      });
    }
    ownerShortId = authoritativeAsset?.ownerPinitId ?? null;

    if (verifiedCandidate) {
      logCandidateStage('pre_fusion', verifiedCandidate, undefined, {
        dna15: dna15Score,
        localDnaScore: authoritativeAsset?.localDnaHit ? localDnaScore : 0,
        vectorComposite: assetVector?.scores.composite,
        bestDeepScore: authoritativeAsset?.deepCompare?.overallConfidenceScore,
      });
    }

    // Video only: proxy dna15 from strong vector/local-patch when deep DNA incomplete.
    // Images must never inflate DNA from retrieval alone (causes logo→portrait false locks).
    if (dna15Score === 0 && authoritativeAsset && !isImageProbe) {
      const src = authoritativeAsset.selectionSource;
      if (src === 'local_patch' && localDnaScore >= 45) {
        dna15Score = localDnaScore;
      } else if (src === 'vector_top' && assetVector && assetVector.scores.composite >= 50) {
        dna15Score = Math.max(
          assetVector.scores.composite,
          assetVector.scores.perceptualBlend,
        );
      }
    }

    // ═══ Stage 6 — Confidence fusion (authoritative vault scores only) ════════
    const fusion = confidenceFusionEngine.fuse({
      watermarkScore,
      identityTokenScore: Math.max(identityTokenScore, ocrScore),
      manifestScore,
      certificateScore,
      sha256Score,
      dna15LayerScore: dna15Score,
      perceptualHashScore: assetVector?.scores.perceptualBlend ?? 0,
      structuralScore: assetVector?.scores.structural ?? 0,
      semanticScore: assetVector?.scores.clip ?? 0,
      localFeatureScore: Math.max(
        assetVector?.scores.orb ?? 0,
        authoritativeAsset?.localDnaHit ? localDnaScore : 0,
        authoritativeAsset?.localDnaHit?.orbRefineScore ?? 0,
      ),
      localPatchScore: authoritativeAsset?.localDnaHit ? localDnaScore : 0,
      patchVoteCount: authoritativeAsset?.localDnaHit?.patchMatchCount ?? 0,
      geometricScore: authoritativeAsset?.localDnaHit?.geometricScore ?? 0,
      ocrScore,
      candidate: authoritativeAsset?.rankedCandidate ?? null,
      match: verifiedCandidate,
      vaultVectorComposite: assetVector?.scores.composite,
      partialVideoScore: isVideoProbeEarly ? partialVideoScore : undefined,
      partialVideoFrameRatio: isVideoProbeEarly ? partialVideoFrameRatio : undefined,
      partialVideoFrameCount: isVideoProbeEarly ? partialVideoMatchedFrames : undefined,
    });

    stages.push({
      stage: STAGE.FUSION,
      status: fusion.retrievalConfidence >= 75 ? 'complete' : fusion.retrievalConfidence >= 50 ? 'partial' : 'failed',
      detail: `Retrieval ${fusion.retrievalConfidence}% · identity ${fusion.identityConfidence}% · ownership ${fusion.ownershipVerificationConfidence}%`,
    });

    // ═══ Stage 7 — Decision (retrieval-first; identity recovery is separate) ═══
    const margin = (assetVector?.scores.composite ?? 0) - (secondVector?.scores.composite ?? 0);
    const patchVotes = authoritativeAsset?.localDnaHit?.patchMatchCount ?? 0;
    const hasPartialVideoAnchor = isVideoProbeEarly && (
      assetVector?.signals.includes('partial_video_recovery')
      || (partialVideoMatchedFrames >= 3 && partialVideoFrameRatio >= 0.35)
      || partialVideoScore >= 40
    );

    const hasForensicAnchor =
      sha256Score === 100
      || identityTokenScore >= 50
      || watermarkScore >= 50
      || manifestScore >= 50
      || ocrScore >= 65
      || (authoritativeAsset?.localDnaHit && localDnaScore >= 45)
      || patchVotes >= 20
      || (assetVector?.scores.orb ?? 0) >= 45
      || (assetVector?.scores.perceptualBlend ?? 0) >= 52
      || (assetVector?.scores.structural ?? 0) >= 55
      || dna15Score >= 38
      || hasPartialVideoAnchor
      || fusion.retrievalConfidence >= 50;

    const filenameOnly = (authoritativeAsset?.rankedCandidate?.signals.length === 0
      || (!authoritativeAsset && candidates[0]?.signals.length === 0))
      && !hasForensicAnchor;

    const ambiguous = margin < 3
      && fusion.retrievalConfidence < 90
      && sha256Score < 100
      && patchVotes < 30;

    const retrievalConf = fusion.retrievalConfidence;

    const retrievalIdentified =
      !!verifiedCandidate
      && !filenameOnly
      && hasForensicAnchor
      && (
        retrievalConf >= 75
        || sha256Score === 100
        || (retrievalConf >= 50 && margin >= 2 && dna15Score >= 38)
      );

    const identified = retrievalIdentified && !(ambiguous && retrievalConf < 90);

    const reportState: 'VERIFIED' | 'POSSIBLE' | 'NO_SIGNATURE' = !verifiedCandidate
      ? 'NO_SIGNATURE'
      : identified || retrievalConf >= 75
        ? 'VERIFIED'
        : 'POSSIBLE';

    const reportStateReason = !verifiedCandidate
      ? `No retrieval anchor — retrieval ${retrievalConf}%`
      : reportState === 'VERIFIED'
        ? `Verified — retrieval ${retrievalConf}%, margin ${margin}, dna15 ${dna15Score}%`
        : `Possible match — retrieval ${retrievalConf}%, identity signals degraded`;

    stages.push({
      stage: STAGE.DECISION,
      status: reportState === 'VERIFIED' ? 'complete' : reportState === 'POSSIBLE' ? 'partial' : 'failed',
      detail: reportState === 'NO_SIGNATURE'
        ? `${FORENSIC_VERDICT_LABELS.NO_SIGNATURE} — retrieval ${retrievalConf}%`
        : reportState === 'VERIFIED'
          ? `Verified Original PINIT Asset — retrieval ${retrievalConf}%`
          : `Possible PINIT Asset — vault ${verifiedCandidate!.vaultId.slice(0, 8)}… · retrieval ${retrievalConf}%`,
    });

    logCandidateStage('decision', verifiedCandidate, fusion, {
      identified,
      reportState,
      reportStateReason,
      probable: reportState === 'POSSIBLE',
    });

    if (verifiedCandidate && reportState !== 'NO_SIGNATURE') {
      const ownerSnap = await loadVaultOwnerSnapshot(
        verifiedCandidate.vaultId,
        verifiedCandidate.dnaRecordId,
      );
      emitPhase({
        phase: 'final',
        signatureFound: true,
        vaultId: verifiedCandidate.vaultId,
        dnaRecordId: verifiedCandidate.dnaRecordId,
        confidence: retrievalConf,
        similarityScore: assetVector?.scores.perceptualBlend,
        statusMessage: reportState === 'VERIFIED'
          ? REPORT_STATE_LABELS.VERIFIED
          : REPORT_STATE_LABELS.POSSIBLE,
        ...ownerSnap,
      });
    } else {
      emitPhase({
        phase: 'final',
        signatureFound: false,
        vaultId: undefined,
        dnaRecordId: undefined,
        ownerName: undefined,
        ownerPinitId: undefined,
        originalFilename: undefined,
        confidence: retrievalConf,
        statusMessage: REPORT_STATE_LABELS.NO_SIGNATURE,
      });
    }

    const authDeep = authoritativeAsset?.deepCompare ?? null;
    const tamperingSummary = authDeep
      ? authDeep.tamperingDetected
        ? `Tampering detected — ${authDeep.classification} (${authDeep.overallConfidenceScore}%)`
        : `Content verified — ${authDeep.classification}`
      : identified ? 'Identified via vault similarity vector' : null;

    logger.info('[PinitOIR] Recovery complete', {
      identified,
      retrievalConfidence: fusion.retrievalConfidence,
      forensicVerdict: fusion.forensicVerdict,
      ownershipVerification: fusion.ownershipVerificationConfidence,
      authoritativeVault: authoritativeAsset?.vaultId?.slice(0, 8),
      authoritativeSource: authoritativeAsset?.selectionSource,
      dna15: dna15Score,
      twoStage,
      totalMs: timer.totalMs(),
    });

    if (twoStage) timer.logSummary('PinitOIR-Investigation');

    return {
      match: identified ? verifiedCandidate : null,
      probableMatch: !identified && verifiedCandidate ? verifiedCandidate : null,
      verifiedCandidate,
      bestCandidate: verifiedCandidate,
      authoritativeAsset,
      reportState,
      reportStateReason,
      candidates,
      fusion,
      stages,
      variantCount: vectorVariants.length,
      manifestRecovered,
      identityTokenRecovered,
      watermarkRecovered,
      identified,
      highConfidence: fusion.highConfidence,
      recoveredSignals,
      deepCompareResults: authDeep ? [authDeep] : [],
      certificateId,
      ownerShortId,
      tamperingSummary,
      bestDeepCompare: authDeep,
      stageTimings: timer.getTimings(),
      auditContext: {
        vectors,
        vaultRecordIds: vaultRecordIdsLoaded,
        selectionSteps,
        identityHit,
        localDnaHit,
        candidateRankingLogs,
        forensicScan: forensicScanResult,
      },
    };
  }
}

export const pinitOriginalIdentityRecoveryService = new PinitOriginalIdentityRecoveryService();
