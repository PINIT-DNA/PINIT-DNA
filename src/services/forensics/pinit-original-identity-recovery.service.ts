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
import { enterpriseRetrievalEngine } from './enterprise-retrieval-engine.service';
import type { LocalDnaSearchHit } from './vault-local-dna-search.service';
import { localDnaConfig } from '../../config/local-dna';
import { deepVaultCompareService, type DeepCompareResult } from './deep-vault-compare.service';
import { confidenceFusionEngine, FORENSIC_VERDICT_LABELS } from './confidence-fusion-engine.service';
import { vaultCandidateRankingService } from './vault-candidate-ranking.service';
import { pinitIdentificationConfig } from '../../config/pinit-identification';
import { investigationPerformanceConfig, clampCandidatePool } from '../../config/investigation-performance';
import { runParallelForensicRecovery } from './parallel-forensic-recovery.service';
import { createStageTimer, type StageTimer } from '../../lib/stage-timer';
import { withTimeoutSoft } from '../../lib/safe-runner';
import type { InvestigationProgressEvent, InvestigationLiveSnapshot } from '../../types/unified-investigation.types';
import { mergeSnapshot } from './investigation-live-snapshot';
import type { VaultMatchResult } from './vault-auto-match.service';
import type {
  PinitIdentificationResult,
  RecoveryStage,
  RecoveredIdentitySignal,
} from './pinit-identification-engine.service';

function deepCompareToMatch(deep: DeepCompareResult, ownerUserId: string): VaultMatchResult {
  return {
    tier: 4,
    method: `15-layer DNA compare (${deep.overallConfidenceScore}%)`,
    dnaRecordId: deep.dnaRecordId,
    vaultId: deep.vaultId,
    ownerUserId,
    confidence: String(deep.overallConfidenceScore),
    visualSimilarity: deep.overallConfidenceScore / 100,
  };
}

function localHitToMatch(hit: LocalDnaSearchHit, score: number): VaultMatchResult {
  return {
    tier: 3,
    method: `Local patch DNA (${hit.patchMatchCount} patches)`,
    dnaRecordId: hit.dnaRecordId,
    vaultId: hit.vaultId,
    ownerUserId: hit.ownerUserId,
    confidence: String(score),
    visualSimilarity: (hit.orbRefineScore || score) / 100,
  };
}

function resolveBestCandidate(
  match: VaultMatchResult | null,
  localDnaHit: LocalDnaSearchHit | null,
  localDnaScore: number,
  bestDeep: DeepCompareResult | null,
  candidates: import('../../types/unified-investigation.types').RankedVaultCandidate[],
  ownerUserId: string,
): VaultMatchResult | null {
  if (match) return match;
  if (localDnaHit && localDnaScore >= 30) return localHitToMatch(localDnaHit, localDnaScore);
  if (bestDeep && bestDeep.overallConfidenceScore >= 30) return deepCompareToMatch(bestDeep, ownerUserId);
  if (candidates[0] && candidates[0].compositeScore >= 30) {
    return vaultCandidateRankingService.toVaultMatch(candidates[0]);
  }
  return null;
}

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
  dnaRecordId?: string,
): Promise<Pick<InvestigationLiveSnapshot, 'ownerName' | 'ownerPinitId' | 'originalFilename'>> {
  const [vaultRow, dnaRow] = await Promise.all([
    prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      select: { originalFileName: true, dnaRecordId: true },
    }),
    dnaRecordId
      ? prisma.dnaRecord.findUnique({
        where: { id: dnaRecordId },
        select: { imageFilename: true, ownerUserId: true },
      })
      : Promise.resolve(null),
  ]);
  const ownerUserId = dnaRow?.ownerUserId
    ?? (vaultRow?.dnaRecordId
      ? (await prisma.dnaRecord.findUnique({
        where: { id: vaultRow.dnaRecordId },
        select: { ownerUserId: true, imageFilename: true },
      }))?.ownerUserId
      : undefined);
  const filename = dnaRow?.imageFilename
    ?? (vaultRow?.dnaRecordId
      ? (await prisma.dnaRecord.findUnique({
        where: { id: vaultRow.dnaRecordId },
        select: { imageFilename: true },
      }))?.imageFilename
      : undefined);
  const ownerRow = ownerUserId
    ? await prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { fullName: true, shortId: true },
    })
    : null;
  return {
    ownerName: ownerRow?.fullName ?? undefined,
    ownerPinitId: ownerRow?.shortId ?? undefined,
    originalFilename: filename ?? vaultRow?.originalFileName ?? undefined,
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

    return {
      match,
      probableMatch: null,
      bestCandidate: match,
      candidates,
      fusion,
      stages,
      variantCount: 1,
      manifestRecovered: false,
      identityTokenRecovered: false,
      watermarkRecovered: false,
      identified: true,
      highConfidence: fusion.highConfidence,
      recoveredSignals: [{ stage: STAGE.FORENSIC, score: 100, recovered: true, detail: 'SHA-256 exact' }],
      deepCompareResults: [],
      certificateId: null,
      ownerShortId: exact.ownerUser?.shortId ?? null,
      tamperingSummary: 'Byte-identical to vault original',
      bestDeepCompare: null,
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

    const useFullRetrieval = !twoStage && (options?.retrievalMode || !options?.investigationMode);

    timer.start('preprocessing');
    emit({ type: 'timeline', stepId: 'preprocessing', label: 'Preprocessing', status: 'running' });

    const variants = await forensicImagePreprocessor.generateVariants(buffer, mimeType, {
      fast: twoStage || (options?.fastVariants && !useFullRetrieval),
      minimal: twoStage,
      scanner: twoStage ? false : pinitIdentificationConfig.phase5ScannerPipeline,
    });
    const forensicVariants = twoStage
      ? [{ label: 'original', buffer, mimeType }]
      : useFullRetrieval
        ? variants
        : options?.investigationMode
          ? [{ label: 'original', buffer, mimeType }]
          : options?.fastVariants
            ? variants.filter((v) => v.label === 'original' || v.label === 'normalized')
            : variants;

    const vectorVariants = twoStage
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

    // ═══ Stage 1 — Forensic recovery (parallel in investigation two-stage mode) ═══
    timer.start('identity_recovery');
    emit({ type: 'timeline', stepId: 'identity_recovery', label: 'Identity Recovery', status: 'running' });

    if (twoStage && !isExactVaultMatch) {
      timer.start('vault_search');
      emit({ type: 'timeline', stepId: 'vault_search', label: 'Vault Search', status: 'running' });

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
      if (topFast && !identityHit && !earlyVaultShown) {
        const ownerSnap = await loadVaultOwnerSnapshot(topFast.vaultId, topFast.dnaRecordId);
        emitPhase({
          phase: 1,
          signatureFound: true,
          vaultId: topFast.vaultId,
          dnaRecordId: topFast.dnaRecordId,
          confidence: topFast.scores.composite,
          similarityScore: topFast.scores.perceptualBlend,
          statusMessage: 'Possible vault match — verifying…',
          ...ownerSnap,
        });
      } else if (topFast && identityHit) {
        emitPhase({
          phase: 1,
          signatureFound: true,
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
    const skipLocalDna = twoStage
      && hasStrongIdentityAnchor
      && investigationPerformanceConfig.skipLocalDnaWhenWatermark;

    if (skipLocalDna) {
      emit({
        type: 'timeline',
        stepId: 'orb_verification',
        label: 'ORB Verification',
        status: 'skipped',
        detail: 'Skipped — vault already identified via watermark/token',
      });
      stages.push({
        stage: STAGE.LOCAL_DNA,
        status: 'skipped',
        detail: `Watermark/identity anchor — patch search skipped (${identityHit?.method ?? 'tier ≤2'})`,
      });
    } else if (localDnaConfig.enabled && mimeType.startsWith('image/') && !isExactVaultMatch) {
      timer.start('local_dna');
      emit({ type: 'timeline', stepId: 'orb_verification', label: 'ORB Verification', status: 'running' });

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
          investigationPerformanceConfig.localDnaTimeoutMs,
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

      if (localDnaHit && localDnaScore >= localDnaConfig.identifyCompositeThreshold && !identityHit) {
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
      const topVec = vectors[0];
      if (topVec && !localDnaHit) {
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

    // Promote local-DNA hit into candidate list for deep compare + fusion
    if (localDnaHit && localDnaScore >= 50) {
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
    const secondVector = vectors[1] ?? null;

    // ═══ Stage 5 — 15-layer DNA compare on Top N ════════════════════════════
    let deepCompareResults: Awaited<ReturnType<typeof deepVaultCompareService.compareTopCandidates>> = [];
    let bestDeep: (typeof deepCompareResults)[0] | null = null;
    let dna15Score = isExactVaultMatch ? 100 : 0;

    if (isExactVaultMatch) {
      stages.push({
        stage: STAGE.DEEP_COMPARE,
        status: 'skipped',
        detail: 'SHA-256 exact match — 15-layer compare skipped',
      });
    } else {
      timer.start('deep_dna_compare');
      emit({ type: 'timeline', stepId: 'deep_dna_compare', label: 'Deep DNA Compare', status: 'running' });
      emitPhase({
        phase: 3,
        deepVerificationRunning: true,
        statusMessage: 'Running 15-layer forensic verification…',
      });

      let deepCandidates = candidates;
      const deepTopN = twoStage && hasStrongIdentityAnchor
        ? 1
        : (options?.deepCompareTopN ?? pinitIdentificationConfig.deepCompareTopN);
      if (twoStage && hasStrongIdentityAnchor && identityHit) {
        deepCandidates = candidates.filter((c) => c.vaultId === identityHit!.vaultId);
      }

      deepCompareResults = await withTimeoutSoft(
        () => deepVaultCompareService.compareTopCandidates(
          buffer, mimeType, originalName, sizeBytes, deepCandidates, ownerUserId, deepTopN,
        ),
        investigationPerformanceConfig.deepCompareTimeoutMs,
        'deep_dna_compare',
      ) ?? [];
      bestDeep = deepCompareResults[0] ?? null;
      dna15Score = bestDeep?.overallConfidenceScore ?? 0;

      if (bestDeep) {
        emitPhase({
          phase: 3,
          deepVerificationRunning: false,
          dnaMatchPercent: bestDeep.overallConfidenceScore,
          confidence: bestDeep.overallConfidenceScore,
          statusMessage: `15-layer DNA: ${bestDeep.overallConfidenceScore}% — ${bestDeep.classification}`,
        });
      }

      timer.end('deep_dna_compare');
      emit({
        type: 'timeline',
        stepId: 'deep_dna_compare',
        label: 'Deep DNA Compare',
        status: bestDeep ? 'complete' : 'skipped',
        elapsedMs: timer.getTimings().find((t) => t.stage === 'deep_dna_compare')?.durationMs,
      });

      stages.push({
        stage: STAGE.DEEP_COMPARE,
        status: bestDeep ? 'complete' : 'skipped',
        detail: bestDeep
          ? `15-layer compare: ${bestDeep.overallConfidenceScore}% (${bestDeep.classification}) · ${bestDeep.matchedLayerCount}/${bestDeep.totalLayers} layers`
          : 'No deep compare',
      });
    }

    // Select winning vault record — priority: identity hit > vector top > deep compare
    let match: VaultMatchResult | null = identityHit;

    if (!match && topVector && topVector.scores.composite >= 38) {
      match = vaultCandidateRankingService.toVaultMatch(candidates[0]!);
    }

    if (!match && localDnaHit && localDnaScore >= 38) {
      match = localHitToMatch(localDnaHit, localDnaScore);
    }

    if (!match && bestDeep && bestDeep.overallConfidenceScore >= 30) {
      match = deepCompareToMatch(bestDeep, ownerUserId);
    }

    // Always preserve winning candidate for report hydration even if thresholds above missed
    const bestCandidate = resolveBestCandidate(match, localDnaHit, localDnaScore, bestDeep, candidates, ownerUserId);
    if (!match && bestCandidate) {
      match = bestCandidate;
      logCandidateStage('match_fallback', bestCandidate, undefined, { reason: 'bestCandidate promoted for fusion' });
    }

    logCandidateStage('pre_fusion', match, undefined, {
      dna15: dna15Score,
      localDnaScore,
      vectorComposite: topVector?.scores.composite,
      bestDeepScore: bestDeep?.overallConfidenceScore,
    });

    // Prefer vector winner when deep compare is weak but vector is strong (regression fix)
    if (topVector && match) {
      const matchScore = Number.parseInt(match.confidence, 10) || 0;
      if (topVector.scores.composite >= 82 && topVector.scores.composite > matchScore + 10) {
        match = vaultCandidateRankingService.toVaultMatch(candidates[0]!);
      }
    }

    if (match && !certificateId) {
      const cert = await certificateService.findActiveForAsset({
        dnaRecordId: match.dnaRecordId,
        vaultId: match.vaultId,
        ownerUserId: match.ownerUserId,
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
      localFeatureScore: Math.max(topVector?.scores.orb ?? 0, localDnaScore, localDnaHit?.orbRefineScore ?? 0),
      localPatchScore: localDnaScore,
      patchVoteCount: localDnaHit?.patchMatchCount ?? 0,
      geometricScore: localDnaHit?.geometricScore ?? 0,
      ocrScore,
      candidate: candidates[0] ?? null,
      match,
      vaultVectorComposite: topVector?.scores.composite,
    });

    stages.push({
      stage: STAGE.FUSION,
      status: fusion.retrievalConfidence >= 75 ? 'complete' : fusion.retrievalConfidence >= 50 ? 'partial' : 'failed',
      detail: `Retrieval ${fusion.retrievalConfidence}% · identity ${fusion.identityConfidence}% · ownership ${fusion.ownershipVerificationConfidence}%`,
    });

    // ═══ Stage 7 — Decision (retrieval-first; identity recovery is separate) ═══
    const margin = (topVector?.scores.composite ?? 0) - (secondVector?.scores.composite ?? 0);
    const patchVotes = localDnaHit?.patchMatchCount ?? 0;
    const hasForensicAnchor =
      sha256Score === 100
      || identityTokenScore >= 50
      || watermarkScore >= 50
      || manifestScore >= 50
      || ocrScore >= 65
      || localDnaScore >= 45
      || patchVotes >= 20
      || (topVector?.scores.orb ?? 0) >= 45
      || (topVector?.scores.perceptualBlend ?? 0) >= 52
      || (topVector?.scores.structural ?? 0) >= 55
      || dna15Score >= 38
      || fusion.retrievalConfidence >= 50;

    const filenameOnly = candidates[0]?.signals.length === 0
      && !hasForensicAnchor;

    const ambiguous = margin < 3
      && fusion.retrievalConfidence < 90
      && sha256Score < 100
      && patchVotes < 30;

    const retrievalConf = fusion.retrievalConfidence;
    const forensicVerdict = fusion.forensicVerdict;

    const retrievalIdentified =
      !!match
      && !filenameOnly
      && hasForensicAnchor
      && (
        retrievalConf >= 75
        || sha256Score === 100
        || (retrievalConf >= 50 && margin >= 2 && dna15Score >= 38)
      );

    const identified = retrievalIdentified && !(ambiguous && retrievalConf < 90);

    stages.push({
      stage: STAGE.DECISION,
      status: identified ? 'complete' : retrievalConf >= 50 ? 'partial' : 'failed',
      detail: identified
        ? `${FORENSIC_VERDICT_LABELS[forensicVerdict]} — retrieval ${retrievalConf}%`
        : retrievalConf >= 50
          ? `${FORENSIC_VERDICT_LABELS[forensicVerdict]} — identity partially recovered (retrieval ${retrievalConf}%)`
          : `${FORENSIC_VERDICT_LABELS.NO_SIGNATURE} — retrieval ${retrievalConf}%`,
    });

    logCandidateStage('decision', match, fusion, { identified, probable: !identified && !!match });

    const tamperingSummary = bestDeep
      ? bestDeep.tamperingDetected
        ? `Tampering detected — ${bestDeep.classification} (${bestDeep.overallConfidenceScore}%)`
        : `Content verified — ${bestDeep.classification}`
      : identified ? 'Identified via vault similarity vector' : null;

    logger.info('[PinitOIR] Recovery complete', {
      identified,
      retrievalConfidence: fusion.retrievalConfidence,
      forensicVerdict: fusion.forensicVerdict,
      ownershipVerification: fusion.ownershipVerificationConfidence,
      topVector: topVector?.scores.composite,
      dna15: dna15Score,
      vaultId: match?.vaultId?.slice(0, 8),
      twoStage,
      totalMs: timer.totalMs(),
    });

    if (twoStage) timer.logSummary('PinitOIR-Investigation');

    return {
      match: identified ? match : null,
      probableMatch: !identified && match ? match : null,
      bestCandidate: bestCandidate ?? match,
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
      deepCompareResults,
      certificateId,
      ownerShortId,
      tamperingSummary,
      bestDeepCompare: bestDeep,
      stageTimings: timer.getTimings(),
    };
  }
}

export const pinitOriginalIdentityRecoveryService = new PinitOriginalIdentityRecoveryService();
