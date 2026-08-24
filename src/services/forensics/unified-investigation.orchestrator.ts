/**
 * Unified Forensic Investigation Center — orchestrates existing services only.
 */
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { leakedFileVerifyService } from './leaked-file-verify.service';
import { type VaultMatchResult, vaultAutoMatchService } from './vault-auto-match.service';
import { certificateService } from '../certificates/certificate.service';
import { shareLinkService } from '../share/share-link.service';
import { isPhase2Active } from '../../config/dna-phase2';
import { resolveWatermarkProof } from './watermark-status.service';
import { enterpriseRecoveryPipeline, type EnterpriseRecoveryResult } from './enterprise-recovery-pipeline.service';
import { promoteLeakVerifyToAuthoritative, isStrongLeakIdentity, emptyEnterpriseForLeakPromote, ensureLeakVaultId } from './leak-verify-authoritative-bridge.service';
import { beginInvestigationWork, endInvestigationWork } from './investigation-busy.guard';
import { FORENSIC_VERDICT_LABELS, type ForensicVerdict } from './confidence-fusion-engine.service';
import {
  deriveInvestigationOutcome,
  downgradeToPossibleAfterWeakDna,
  forensicVerdictForSummary,
  insufficientEvidenceOutcome,
  logInvestigationDecision,
  notPinitOutcome,
  REPORT_STATE_LABELS,
  reAcceptWithDnaCompare,
  shouldRetainRetrievalCandidateAsPossible,
  type InvestigationOutcome,
} from './investigation-decision-resolver.service';
import { logInvestigationScores } from './investigation-score-logger';
import { buildInvestigationManifest } from './investigation-manifest.builder';
import {
  runAcceptanceEngine,
  passChannel,
  failChannel,
  skippedChannel,
} from './acceptance-engine.service';
import {
  mapAcceptanceToForensicVerdict,
  mapAcceptanceToReportState,
} from './investigation-decision-resolver.service';
import { investigationPerformanceConfig } from '../../config/investigation-performance';
import {
  LOCAL_PATCH_RESCUE_MIN,
  NOT_FOUND_MAX_WITHOUT_PATCH,
  POSSIBLE_L3_MIN_WITHOUT_PATCH,
  POSSIBLE_MIN,
} from '../../config/investigation-match-policy';
import { createStageTimer } from '../../lib/stage-timer';
import { sanitizeInvestigationError } from '../../lib/sanitize-investigation-error';
import { withTimeoutSoft } from '../../lib/safe-runner';
import { isAcceptedAfterDnaCompare, isCameraScanFileName, explainMatchBasis } from './vault-match-validator.service';
import { buildExplainableMatchReasons, buildForensicEvidenceSection } from './explainable-matching.service';
import { forensicScannerService } from './forensic-scanner.service';
import { VaultService } from '../vault/vault.service';

const vaultService = new VaultService();
import { evidenceConfidenceService } from './evidence-confidence.service';
import { auditService } from '../audit/audit.service';
import crypto from 'crypto';
import type {
  UnifiedInvestigationReport,
  InvestigationPipelineStep,
  InvestigationProgressEvent,
  InvestigationLiveSnapshot,
  LeakedFileAccessEntry,
  RankedVaultCandidate,
  IdentityRecoveryReportSection,
  IdentityRecoverySection,
  LeakIntelligenceSection,
  TamperAnalysisSection,
} from '../../types/unified-investigation.types';
import { mergeSnapshot } from './investigation-live-snapshot';
import {
  auditReportConsistency,
  buildInvestigationPipelineAudit,
} from './investigation-pipeline-audit.service';
import type { InvestigationPipelineAudit } from '../../types/investigation-pipeline-audit.types';
import {
  assertDnaScope,
  assertVaultScope,
} from './authoritative-asset.service';
import {
  compareProbeToAuthoritativeAsset,
  comparisonFromDeepCompareResult,
} from './authoritative-dna-compare.service';
import type { DnaComparisonResult } from '../../types/comparison.types';
import {
  executeStage,
  executeStageSync,
  executeStagesParallel,
} from './investigation-stage.executor';
import {
  buildTamperAnalysis,
  buildLiveLeadTamperAnalysis,
  emptyTamperAnalysis,
} from './tamper-analysis.service';
import { fragmentSpliceDetectorService } from './fragment-splice-detector.service';
import type { FragmentReuseFinding, FragmentReuseSection } from '../../types/unified-investigation.types';
import { DNA_LAYER_REGISTRY } from '../../constants/dna-layer-registry';
import { DocumentLineageService } from '../lineage/document-lineage.service';

const documentLineageService = new DocumentLineageService();

/**
 * Resolve the probe's own permanent DnaRecord id (created moments earlier by
 * the ephemeral fingerprinter, soft-archived rather than deleted — see
 * src/lib/dna-immutability.ts) via its exact content hash, then record the
 * probe -> matched-original relationship into the document_lineage graph.
 * Fault-isolated: lineage is supplemental evidence, never blocks a report.
 */
async function recordLineageEdge(params: {
  currentFileHash: string;
  matchedDnaRecordId: string;
  classification: string;
  confidence: number;
  changedLayers: string[];
  primaryTamperVector?: string | null;
  fragmentDetected?: boolean;
  fragmentConfidence?: number | null;
}): Promise<void> {
  try {
    const probeRecord = await prisma.dnaRecord.findFirst({
      where: { sha256Hash: params.currentFileHash },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!probeRecord || probeRecord.id === params.matchedDnaRecordId) return;

    await documentLineageService.recordRelationship({
      dnaRecordIdA: params.matchedDnaRecordId,
      dnaRecordIdB: probeRecord.id,
      classification: params.classification,
      confidence: params.confidence,
      changedLayers: params.changedLayers,
      primaryTamperVector: params.primaryTamperVector,
      fragmentDetected: params.fragmentDetected,
      fragmentConfidence: params.fragmentConfidence,
    });
  } catch (e) {
    logger.warn('[UnifiedInvestigation] Lineage recording failed', { error: String(e) });
  }
}

/**
 * Authorization verdict — reads context leaked-file-verify.service.ts already
 * resolved (share link / recipient / tracked export package) rather than
 * running any new detection. A populated share/TEP context means the probe
 * traces back to a specific grant this platform issued; a real DNA match with
 * none of that context means the platform has no record of authorizing this
 * copy — which is evidence of "not authorized through this platform", not
 * proof of unauthorized use (content shared entirely outside the platform
 * leaves no trail either way).
 */
function resolveAuthorizationStatus(
  matched: boolean,
  leakVerify: { shareLink?: unknown; recipient?: unknown; tep?: { code?: string } | null } | null | undefined,
): 'AUTHORIZED' | 'UNKNOWN_ORIGIN' | 'NOT_APPLICABLE' {
  if (!matched) return 'NOT_APPLICABLE';
  if (leakVerify?.shareLink || leakVerify?.recipient || leakVerify?.tep?.code) return 'AUTHORIZED';
  return 'UNKNOWN_ORIGIN';
}

function buildFragmentReuseSection(findings: FragmentReuseFinding[]): FragmentReuseSection {
  const top = findings[0];
  return {
    detected: findings.length > 0,
    findings,
    summary: top
      ? `A protected original's content (${top.patchMatchCount} matching patches, ${top.confidence}% confidence) appears composited into a localized region of this image.`
      : 'No fragment reuse detected.',
  };
}
import { tepService } from '../tep/tep.service';

function step(
  id: string,
  label: string,
  status: InvestigationPipelineStep['status'],
  detail?: string,
): InvestigationPipelineStep {
  return { id, label, status, detail };
}

function layerStatus(pct: number, skipped?: boolean): 'verified' | 'warning' | 'failed' | 'skipped' {
  if (skipped) return 'skipped';
  if (pct >= 80) return 'verified';
  if (pct >= 50) return 'warning';
  return 'failed';
}

type TamperAnalysisLike = ReturnType<typeof buildTamperAnalysis>;

/**
 * Mode A spatial verify for Investigate reports (main + partial paths).
 * Always attempts to attach investigation payload when DNA + probe image exist.
 */
async function attachSpatialAuthToTamper(params: {
  tamperAnalysis: TamperAnalysisLike;
  dnaRecordId?: string | null;
  probeBuffer?: Buffer | null;
  mimeType?: string | null;
  pipeline?: InvestigationPipelineStep[];
}): Promise<TamperAnalysisLike> {
  const { dnaRecordId, probeBuffer, mimeType, pipeline } = params;
  let { tamperAnalysis } = params;

  if (!dnaRecordId || !probeBuffer || !(mimeType ?? '').startsWith('image/')) {
    logger.info('Spatial auth skipped — missing dna/probe/image', {
      hasDna: !!dnaRecordId,
      hasProbe: !!probeBuffer,
      mimeType: mimeType ?? null,
    });
    return {
      ...tamperAnalysis,
      spatialAuthInvestigation: {
        trusted: false,
        localizationClaim: '8x8_cell',
        verificationStatus: 'SKIPPED',
        unavailableReason: 'Spatial auth needs an image probe and matched DNA record.',
      },
      spatialHierarchy: null,
    } as TamperAnalysisLike;
  }

  try {
    const { isSpatialAuthEnabled } = await import('../../config/spatial-auth');
    if (!isSpatialAuthEnabled()) {
      return {
        ...tamperAnalysis,
        spatialAuthInvestigation: {
          trusted: false,
          localizationClaim: '8x8_cell',
          verificationStatus: 'DISABLED',
          unavailableReason: 'SPATIAL_AUTH_ENABLED=false',
        },
        spatialHierarchy: null,
      } as TamperAnalysisLike;
    }

    const { verifyExactSpatialAuthForDna } = await import('../spatial/verify-exact.service');
    const { mergeSpatialVerifyIntoTamperAnalysis } = await import('../spatial/integration');

    const spatialVerifyResult = await withTimeoutSoft(
      () => verifyExactSpatialAuthForDna({
        dnaRecordId,
        candidateImageBuffer: probeBuffer,
      }),
      90_000,
      'spatial_auth_verify',
    );

    if (!spatialVerifyResult) {
      logger.warn('Spatial auth verify timed out or failed', { dnaRecordId: dnaRecordId.slice(0, 8) });
      pipeline?.push(step(
        'spatial_auth',
        'Spatial auth localization',
        'warning',
        'Spatial verify timed out',
      ));
      return {
        ...tamperAnalysis,
        spatialAuthInvestigation: {
          trusted: false,
          localizationClaim: '8x8_cell',
          verificationStatus: 'TIMEOUT',
          unavailableReason: 'Spatial verify timed out — retry Investigate.',
        },
        spatialHierarchy: null,
      } as TamperAnalysisLike;
    }

    logger.info('Spatial auth verify attached to investigation', {
      dnaRecordId: dnaRecordId.slice(0, 8),
      status: spatialVerifyResult.status,
      tampered: spatialVerifyResult.tampered,
      blocksFailed: spatialVerifyResult.blocksFailed,
      hasInvestigation: !!spatialVerifyResult.investigation,
    });

    tamperAnalysis = mergeSpatialVerifyIntoTamperAnalysis(
      tamperAnalysis as unknown as Record<string, unknown>,
      spatialVerifyResult,
    ) as unknown as TamperAnalysisLike;

    pipeline?.push(step(
      'spatial_auth',
      'Spatial auth localization',
      spatialVerifyResult.tampered || (spatialVerifyResult.blocksFailed ?? 0) > 0
        ? 'warning'
        : spatialVerifyResult.status === 'MATCH' || spatialVerifyResult.matched
          ? 'complete'
          : 'warning',
      spatialVerifyResult.detail
        ?? `${spatialVerifyResult.blocksFailed ?? 0} tampered 64×64 · claim 8x8_cell`,
    ));

    return tamperAnalysis;
  } catch (err) {
    logger.warn('Spatial auth attach failed', { dnaRecordId: dnaRecordId.slice(0, 8), error: String(err) });
    pipeline?.push(step('spatial_auth', 'Spatial auth localization', 'failed', String(err).slice(0, 120)));
    return {
      ...tamperAnalysis,
      spatialAuthInvestigation: {
        trusted: false,
        localizationClaim: '8x8_cell',
        verificationStatus: 'ERROR',
        unavailableReason: String(err).slice(0, 200),
      },
      spatialHierarchy: null,
    } as TamperAnalysisLike;
  }
}

/** Estimate 15-layer rows from live retrieval when deep compare did not finish. */
function buildLiveLeadLayerAnalysis(input: {
  dnaPct: number;
  orbScore?: number;
  simScore?: number;
  originalHash?: string;
  currentHash?: string;
}): UnifiedInvestigationReport['layerAnalysis'] {
  const hashMatch = !!input.originalHash && !!input.currentHash
    && input.originalHash.toLowerCase() === input.currentHash.toLowerCase();
  const perceptual = Math.round(input.simScore ?? input.dnaPct ?? 0);
  const structural = Math.round(input.orbScore ?? Math.max(0, perceptual - 5));

  return Object.entries(DNA_LAYER_REGISTRY).map(([n, reg]) => {
    const layer = Number(n);
    let matchPercent = 0;
    let explanation = 'Estimated from live identity recovery — deep 15-layer compare incomplete';

    if (layer === 1) {
      matchPercent = hashMatch ? 100 : 0;
      explanation = hashMatch
        ? 'Exact SHA-256 match with vault original'
        : 'SHA-256 differs from vault original (re-encode or export likely)';
    } else if (layer === 2) {
      matchPercent = structural;
      explanation = 'Structural / edge layout from live ORB retrieval';
    } else if (layer === 3) {
      matchPercent = perceptual;
      explanation = 'Perceptual similarity from live retrieval confidence';
    } else if (layer === 7) {
      matchPercent = Math.round(input.orbScore ?? perceptual * 0.9);
      explanation = 'Local patch / ORB feature match from live vault search';
    } else if (layer <= 10) {
      matchPercent = Math.round(perceptual * (layer === 5 ? 0.88 : 0.92));
    } else if (layer === 12) {
      matchPercent = Math.round(perceptual * 0.75);
      explanation = 'Ownership mark layer — estimated from live match strength';
    } else {
      matchPercent = layer === 11 ? Math.max(0, 100 - Math.round(perceptual * 0.15)) : 0;
      explanation = layer === 11
        ? 'Manipulation risk inverse to match strength'
        : 'Not measured on live-only recovery path';
    }

    return {
      layer,
      name: reg.name,
      matchPercent,
      status: layerStatus(matchPercent, matchPercent === 0 && layer > 10),
      explanation,
    };
  });
}

function riskFromScores(dnaPct: number, tamper: number, found: boolean): UnifiedInvestigationReport['summary']['riskLevel'] {
  if (!found) return 'UNKNOWN';
  if (tamper >= 70) return 'CRITICAL';
  if (dnaPct >= 95 && tamper < 20) return 'LOW';
  if (dnaPct >= 70) return 'MEDIUM';
  return 'HIGH';
}

function auditEventLabel(eventType: string): string | null {
  const map: Record<string, string> = {
    DNA_GENERATED: 'DNA Generated',
    VAULT_RETRIEVED: 'Vault Retrieved',
    FILE_DOWNLOADED: 'File Downloaded',
    CERTIFICATE_ISSUED: 'Certificate Issued',
    CERTIFICATE_REVOKED: 'Certificate Revoked',
    TEP_GENERATED: 'Protected Export Generated',
    TEP_REDISCOVERED: 'Protected Copy Rediscovered',
    DUPLICATE_UPLOAD_ATTEMPT: 'Duplicate Upload Attempt',
    INTEGRITY_CHECK_RUN: 'Integrity Check',
  };
  return map[eventType] ?? null;
}

function accessActionToStage(action: string): string {
  const a = action.toUpperCase();
  if (a.includes('SCREENSHOT')) return 'Recipient Screenshot';
  if (a.includes('RECORD')) return 'Recipient Screen Recording';
  if (a.includes('DOWNLOAD')) return 'Recipient Downloaded';
  if (a.includes('VIEW') || a.includes('OPEN')) return 'Recipient Opened';
  if (a.includes('SHARE') || a.includes('LINK')) return 'Shared';
  if (a.includes('EDIT') || a.includes('MODIF')) return 'Recipient Edited';
  if (a.includes('TEP') || a.includes('PROTECTED')) return 'Protected Export';
  return action.replace(/_/g, ' ');
}

interface TimelineBuildInput {
  investigationId: string;
  investigatedAt: string;
  suspectFilename: string;
  suspectFileHash?: string;
  dnaRecordId: string;
  vaultId: string;
  dnaMeta: { createdAt: Date; filename: string } | null;
  shareLinks: Awaited<ReturnType<typeof shareLinkService.getTimelineEvents>>;
  leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>>;
  accessHistory: LeakedFileAccessEntry[];
  auditEvents: Awaited<ReturnType<typeof auditService.getEventsForRecord>>;
  leakIntel?: LeakIntelligenceSection;
  dnaMatchPercent?: number;
  forensicVerdict?: string;
}

const INVESTIGATION_RECOVERY_OPTS = {
  twoStageRetrieval: true,
  investigationMode: true,
  skipProbeDna: true,
  fastVariants: true,
  orbTopK: investigationPerformanceConfig.orbRefineTopK,
  deepCompareTopN: investigationPerformanceConfig.deepCompareTopN,
  candidatePoolSize: investigationPerformanceConfig.candidatePoolSize,
} as const;

const LIVE_TIMELINE_STEPS: Array<{ id: string; label: string }> = [
  { id: 'preprocessing', label: 'Preprocessing' },
  { id: 'identity_recovery', label: 'Identity Recovery' },
  { id: 'vault_search', label: 'Vault Search' },
  { id: 'orb_verification', label: 'ORB Verification' },
  { id: 'deep_dna_compare', label: 'Deep DNA Compare' },
  { id: 'final_report', label: 'Final Report' },
];

export interface InvestigateOptions {
  onProgress?: (event: InvestigationProgressEvent) => void;
}

function formatStageLabel(stage: string): string {
  return stage.replace(/^stage\d+_/, '').replace(/_/g, ' ');
}

function mapEnterpriseStageStatus(
  status: string,
): InvestigationPipelineStep['status'] {
  if (status === 'complete') return 'complete';
  if (status === 'partial') return 'warning';
  if (status === 'skipped') return 'skipped';
  return 'failed';
}

function buildForensicReasons(
  enterprise: EnterpriseRecoveryResult,
  originalName: string,
  certStatus?: string,
): string[] {
  const reasons: string[] = [];
  if (!enterprise.watermarkRecovered) reasons.push('Invisible watermark damaged or absent');
  if (!enterprise.identityTokenRecovered) reasons.push('Identity token partially destroyed');
  if (!enterprise.manifestRecovered) reasons.push('Integrity manifest unavailable');
  if (certStatus === 'NOT_ISSUED' || certStatus?.startsWith('NOT_ISSUED') || certStatus === 'UNKNOWN' || !enterprise.certificateId) {
    reasons.push(
      'Certificate not issued for this vault asset yet (ownership can still be recovered via DNA/visual)',
    );
  }
  const lower = originalName.toLowerCase();
  if (lower.includes('whatsapp')) reasons.push('WhatsApp recompression');
  if (lower.includes('screenshot') || lower.includes('screen')) reasons.push('Screenshot or screen capture');
  if (enterprise.variantCount > 3) reasons.push('Heavy crop or transformation detected');
  return reasons;
}

function mapIdentityStatus(
  enterprise: EnterpriseRecoveryResult,
  leakVerify: { valid?: boolean; found: boolean },
  ownerPinitId?: string | null,
  retrievalConf?: number,
): string {
  if (leakVerify.valid) return 'VERIFIED';
  if (enterprise.watermarkRecovered && enterprise.identityTokenRecovered) return 'RECOVERED';
  if (enterprise.watermarkRecovered || enterprise.identityTokenRecovered) return 'PARTIALLY_RECOVERED';
  if ((retrievalConf ?? 0) >= 50 && ownerPinitId) return 'PARTIALLY_RECOVERED';
  if (leakVerify.found) return 'PARTIAL';
  if (ownerPinitId) return ownerPinitId;
  return 'NOT_FOUND';
}

function buildIdentityRecoveryFromEnterprise(
  enterprise: EnterpriseRecoveryResult,
  outcome: InvestigationOutcome,
): IdentityRecoverySection {
  const message = outcome.state === 'NO_SIGNATURE'
    ? `${REPORT_STATE_LABELS.NO_SIGNATURE} — ${outcome.decisionReason}`
    : `${outcome.displayLabel} — ${outcome.decisionReason}`;

  return {
    enginesRun: enterprise.recoveredSignals.length,
    enginesRecovered: enterprise.recoveredSignals.filter((s) => s.recovered).length,
    signals: enterprise.recoveredSignals.map((s) => ({
      engine: s.stage,
      label: formatStageLabel(s.stage),
      score: s.score,
      weight: 0.1,
      weightedContribution: Math.round(s.score * 0.1 * 100) / 100,
      status: s.recovered ? 'recovered' : 'failed',
      detail: s.detail,
    })),
    compositeScores: {
      ownershipConfidence: enterprise.fusion.ownershipVerificationConfidence,
      trustScore: enterprise.fusion.trustScore,
      identityConfidence: enterprise.fusion.identityConfidence,
      retrievalConfidence: enterprise.fusion.retrievalConfidence,
      ownershipVerificationConfidence: enterprise.fusion.ownershipVerificationConfidence,
    },
    transformations: [],
    message,
  };
}

export class UnifiedInvestigationOrchestrator {
  async investigate(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    ownerUserId: string,
    options?: InvestigateOptions,
  ): Promise<UnifiedInvestigationReport> {
    const investigationId = uuidv4();
    const pipeline: InvestigationPipelineStep[] = [];
    const sizeBytes = buffer.length;
    const progressTimeline: InvestigationProgressEvent[] = [];
    const orchestratorTimer = createStageTimer();

    const liveState: { snapshot: InvestigationLiveSnapshot | null } = { snapshot: null };
    const emit = (event: InvestigationProgressEvent) => {
      // Always merge — never replace/wipe ORB·similarity·vault from a weaker later frame.
      if (event.snapshot) {
        const merged = mergeSnapshot(liveState.snapshot, event.snapshot);
        // Do not allow a terminal "clear vault" patch to erase a prior live lead.
        // Also keep the stronger confidence/filename when vaultId survives but scores drop to 0.
        if (liveState.snapshot?.vaultId && (!merged.vaultId || (merged.confidence ?? 0) < (liveState.snapshot.confidence ?? 0))) {
          liveState.snapshot = {
            ...merged,
            vaultId: merged.vaultId ?? liveState.snapshot.vaultId,
            dnaRecordId: merged.dnaRecordId ?? liveState.snapshot.dnaRecordId,
            ownerName: merged.ownerName ?? liveState.snapshot.ownerName,
            ownerPinitId: merged.ownerPinitId ?? liveState.snapshot.ownerPinitId,
            originalFilename: merged.originalFilename ?? liveState.snapshot.originalFilename,
            orbScore: merged.orbScore ?? liveState.snapshot.orbScore,
            similarityScore: merged.similarityScore ?? liveState.snapshot.similarityScore,
            patchVotes: merged.patchVotes ?? liveState.snapshot.patchVotes,
            confidence: Math.max(merged.confidence ?? 0, liveState.snapshot.confidence ?? 0) || merged.confidence,
            dnaMatchPercent: Math.max(merged.dnaMatchPercent ?? 0, liveState.snapshot.dnaMatchPercent ?? 0)
              || merged.dnaMatchPercent,
            signatureFound: liveState.snapshot.signatureFound || merged.signatureFound,
          };
        } else {
          liveState.snapshot = merged;
        }
      } else if (event.partial?.vaultId) {
        liveState.snapshot = mergeSnapshot(liveState.snapshot, {
          phase: liveState.snapshot?.phase ?? 1,
          signatureFound: true,
          vaultId: event.partial.vaultId,
          ownerPinitId: event.partial.ownerPinitId,
          ownerName: event.partial.ownerName,
          originalFilename: event.partial.originalFilename,
          confidence: event.partial.ownershipConfidence,
          patchVotes: event.partial.patchVotes,
          orbScore: event.partial.orbScore,
        });
      }
      progressTimeline.push(event);
      options?.onProgress?.(event);
    };

    for (const s of LIVE_TIMELINE_STEPS) {
      emit({ type: 'timeline', stepId: s.id, label: s.label, status: 'pending' });
    }

    const currentFileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    const stageOnComplete = (stageName: string, label: string) => (result: { success: boolean; durationMs: number; error: string | null }) => {
      emit({
        type: 'timeline',
        stepId: stageName,
        label,
        status: result.success ? 'complete' : 'warning',
        elapsedMs: result.durationMs,
        detail: result.error ?? undefined,
      });
    };

    const isVideoProbe = mimeType.startsWith('video/')
      || /\.(mp4|mov|avi|mkv|webm|m4v|mpeg|mpg)$/i.test(originalName);
    // Live-lead fast path finishes well under this; hard cap avoids 3–10 min hangs.
    const recoveryTimeoutMs = isVideoProbe
      ? investigationPerformanceConfig.videoRecoveryTimeoutMs
      : investigationPerformanceConfig.imageRecoveryTimeoutMs;

    beginInvestigationWork();
    try {
    import('../platform-events/extended-events').then(({ emitInvestigationStarted }) => {
      emitInvestigationStarted({
        ownerUserId,
        investigationId,
        filename: originalName,
      });
    }).catch(() => {});

    emit({ type: 'timeline', stepId: 'preprocessing', label: 'Preprocessing', status: 'complete' });

    // Quick vault lead before heavy recovery — sets live snapshot so timeouts still produce a report.
    orchestratorTimer.start('fast_vault_lead');
    const fastLeadStage = await executeStage(
      'fast_vault_lead',
      async () => vaultAutoMatchService.findMatch(
        buffer,
        mimeType,
        originalName,
        sizeBytes,
        ownerUserId,
        {
          relaxedVisual: isCameraScanFileName(originalName)
            || /whatsapp|screenshot|screen|photo|scan|cam|compressed/i.test(originalName),
        },
      ),
      {
        timeoutMs: 25_000,
        onComplete: stageOnComplete('vault_search', 'Vault Search'),
      },
    );
    orchestratorTimer.end('fast_vault_lead');

    if (fastLeadStage.success && fastLeadStage.data?.vaultId) {
      const lead = fastLeadStage.data;
      const leadConf = lead.tier <= 2
        ? 95
        : Math.round((lead.visualSimilarity ?? 0.75) * 100);
      emit({
        type: 'phase',
        stepId: 'identity_recovery',
        label: 'Identity Recovery',
        status: lead.tier <= 2 ? 'complete' : 'running',
        snapshot: {
          phase: 1,
          signatureFound: true,
          vaultId: lead.vaultId,
          dnaRecordId: lead.dnaRecordId,
          confidence: leadConf,
          similarityScore: lead.visualSimilarity != null
            ? Math.round(lead.visualSimilarity * 100)
            : undefined,
          statusMessage: `Early vault lead — ${lead.method}`,
        },
      });
    }

    orchestratorTimer.start('enterprise_recovery');
    const recoveryStage = await executeStage(
      'enterprise_recovery',
      async () => {
        // Protected Download / TEP: resolve identity FIRST, then skip heavy DNA entirely.
        const leakRaw = await leakedFileVerifyService.verify(
          buffer, mimeType, originalName, { lightweight: true, ownerUserId },
        );
        const leak = await ensureLeakVaultId(leakRaw);
        if (isStrongLeakIdentity(leak) && leak.identity?.vaultId) {
          logger.info('[Investigation] Strong leak identity — skipping heavy recovery', {
            method: leak.detectionMethod,
            vaultId: leak.identity.vaultId.slice(0, 8),
            confidence: leak.confidence,
          });
          emit({
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
              statusMessage: 'Protected download / TEP identity found — generating report…',
            },
          });
          const enterprise = await promoteLeakVerifyToAuthoritative(
            emptyEnterpriseForLeakPromote(),
            leak,
            ownerUserId,
          );
          return { enterprise, leakVerify: leak };
        }

        const ent = await enterpriseRecoveryPipeline.run(
          buffer, mimeType, originalName, sizeBytes, ownerUserId,
          {
            ...INVESTIGATION_RECOVERY_OPTS,
            onProgress: emit,
            stageTimer: orchestratorTimer,
          },
        );
        return { enterprise: ent, leakVerify: leak };
      },
      {
        timeoutMs: recoveryTimeoutMs,
        // Keep DNA that finishes just after the deadline (Render latency).
        retainGraceMs: 15_000,
        onComplete: stageOnComplete('enterprise_recovery', 'Identity Recovery'),
      },
    );
    orchestratorTimer.end('enterprise_recovery');

    if (!recoveryStage.success || !recoveryStage.data) {
      const timeoutError = sanitizeInvestigationError(
        recoveryStage.error ?? 'Enterprise recovery failed',
      );
      const liveSnapshot = liveState.snapshot;
      // If SSE already showed a vault, never collapse to INSUFFICIENT_EVIDENCE —
      // user already saw the correct candidate (WhatsApp/scanner often times out mid deep-DNA).
      if (liveSnapshot?.vaultId) {
        logger.warn('Enterprise recovery timed out — retaining live vault match', {
          vaultId: liveSnapshot.vaultId,
          confidence: liveSnapshot.confidence,
          error: timeoutError,
        });
        // Keep SSE alive so the UI leaves "verifying" and shows report generation status.
        emit({
          type: 'phase',
          stepId: 'final_report',
          label: 'Investigation Report',
          status: 'running',
          detail: 'Verification complete — generating investigation report…',
          snapshot: {
            ...liveSnapshot,
            phase: 'final',
            signatureFound: true,
            statusMessage: 'Verification complete — generating investigation report…',
          },
        });
        return this.buildPartialFromLiveSnapshot({
          investigationId,
          pipeline,
          progressTimeline,
          currentFileHash,
          originalName,
          ownerUserId,
          snapshot: liveSnapshot,
          error: timeoutError,
          probe: { buffer, mimeType, originalName, sizeBytes },
        });
      }

      // Timeout with no live lead: only rescue strong pHash (≥0.88). Relaxed 0.72
      // falsely pairs unrelated people photos as "Top Candidate" (~65% lookalikes).
      const earlyLead = fastLeadStage.success ? fastLeadStage.data : null;
      const earlySim = earlyLead?.visualSimilarity ?? 0;
      const earlyConf = earlyLead?.confidence === 'EXACT'
        ? 100
        : earlyLead?.tier === 2
          ? 90
          : Math.round(earlySim * 100);
      const earlyIsIdentity = !!earlyLead && (earlyLead.tier === 1 || earlyLead.tier === 2);
      const earlyIsStrongVisual = earlySim >= 0.88 || earlyConf >= POSSIBLE_L3_MIN_WITHOUT_PATCH;
      const rescued = (earlyLead?.vaultId && (earlyIsIdentity || earlyIsStrongVisual))
        ? earlyLead
        : await withTimeoutSoft(
          () => vaultAutoMatchService.findMatch(
            buffer, mimeType, originalName, sizeBytes, ownerUserId,
            { relaxedVisual: false, phashThreshold: 0.88 },
          ),
          20_000,
          'timeout_vault_rescue',
        );
      const rescueSim = rescued?.visualSimilarity ?? 0;
      const rescueConfRaw = Number.parseInt(rescued?.confidence ?? '', 10);
      const rescueConf = Number.isFinite(rescueConfRaw)
        ? rescueConfRaw
        : Math.round(rescueSim * 100);
      const rescueIsIdentity = rescued?.tier === 1 || rescued?.tier === 2;
      const rescueIsStrongVisual = rescueSim >= 0.88 || rescueConf >= POSSIBLE_L3_MIN_WITHOUT_PATCH;
      if (rescued?.vaultId && (rescueIsIdentity || rescueIsStrongVisual)) {
        logger.warn('Enterprise recovery timed out — rescued vault via strong match only', {
          vaultId: rescued.vaultId.slice(0, 8),
          method: rescued.method,
          confidence: rescueConf,
          visualSimilarity: rescueSim,
        });
        const rescueSnapshot = {
          phase: 2 as const,
          signatureFound: true,
          vaultId: rescued.vaultId,
          dnaRecordId: rescued.dnaRecordId,
          confidence: Math.max(rescueConf, POSSIBLE_L3_MIN_WITHOUT_PATCH),
          similarityScore: Math.round(Math.max(rescueSim * 100, rescueConf)),
          statusMessage: 'Timeout rescue — strong vault lead retained for report',
        };
        emit({
          type: 'phase',
          stepId: 'final_report',
          label: 'Investigation Report',
          status: 'running',
          detail: 'Timeout rescue — generating report from strong vault lead…',
          snapshot: rescueSnapshot,
        });
        return this.buildPartialFromLiveSnapshot({
          investigationId,
          pipeline,
          progressTimeline,
          currentFileHash,
          originalName,
          ownerUserId,
          snapshot: rescueSnapshot,
          error: timeoutError,
          probe: { buffer, mimeType, originalName, sizeBytes },
        });
      }

      return this.buildFaultTolerantReport({
        investigationId,
        pipeline,
        progressTimeline,
        currentFileHash,
        originalName,
        leakVerify: null,
        error: timeoutError,
      });
    }

    const { enterprise: enterpriseRaw, leakVerify } = recoveryStage.data;
    const enterprise = await promoteLeakVerifyToAuthoritative(
      enterpriseRaw,
      leakVerify,
      ownerUserId,
    );

    pipeline.push(step(
      'identity',
      'Extract embedded identity',
      leakVerify.found ? 'complete' : 'warning',
      leakVerify.detectionMethod ?? leakVerify.message,
    ));
    if (
      enterprise.authoritativeAsset?.selectionSource === 'identity_hit'
      && leakVerify.found
      && enterprise.authoritativeAsset.vaultId === leakVerify.identity?.vaultId
    ) {
      pipeline.push(step(
        'leak_identity_bridge',
        'Promote protected-download / TEP identity',
        'complete',
        `Locked vault ${enterprise.authoritativeAsset.vaultId.slice(0, 8)}… via ${leakVerify.detectionMethod}`,
      ));
    }

    const forensicStage = enterprise.stages.find((s) => s.stage === 'stage1_forensic_recovery');
    pipeline.push(step(
      'watermark_recovery',
      'Watermark recovery',
      forensicStage?.status === 'complete' ? 'complete' : forensicStage?.status === 'partial' ? 'warning' : 'skipped',
      forensicStage?.detail ?? 'Covered by enterprise forensic recovery',
    ));

    if (isPhase2Active()) {
      pipeline.push(step('lightweight_dna', 'Generate lightweight DNA', 'skipped', 'Delegated to enterprise pipeline'));
    } else {
      pipeline.push(step('lightweight_dna', 'Generate lightweight DNA', 'skipped', 'DNA_PHASE2_ENABLED=false'));
    }

    for (const s of enterprise.stages) {
      pipeline.push(step(
        s.stage,
        formatStageLabel(s.stage),
        mapEnterpriseStageStatus(s.status),
        s.detail,
      ));
    }

    let rankedCandidates: RankedVaultCandidate[] = enterprise.candidates;
    const outcome = deriveInvestigationOutcome(enterprise);
    let reportOutcome = outcome;
    logInvestigationDecision('post_enterprise_recovery', reportOutcome, {
      identified: enterprise.identified,
      fusionVerdict: enterprise.fusion.forensicVerdict,
    });
    logInvestigationScores({
      stage: 'acceptance',
      investigationId,
      vaultId: reportOutcome.candidate?.vaultId,
      dnaRecordId: reportOutcome.candidate?.dnaRecordId,
      fusion: {
        retrieval: enterprise.fusion.retrievalConfidence,
        identity: enterprise.fusion.identityConfidence,
        ownershipVerification: enterprise.fusion.ownershipVerificationConfidence,
        forensicVerdict: enterprise.fusion.forensicVerdict,
      },
      acceptance: {
        verdict: reportOutcome.acceptanceVerdict,
        confidence: reportOutcome.acceptanceConfidence,
        reason: reportOutcome.decisionReason,
      },
      visual: {
        orb: enterprise.authoritativeAsset?.vector?.scores.orb,
        perceptual: enterprise.authoritativeAsset?.vector?.scores.perceptualBlend,
        composite: enterprise.authoritativeAsset?.vector?.scores.composite,
        clip: enterprise.authoritativeAsset?.vector?.scores.clip,
      },
      fingerprint: {
        overall: enterprise.bestDeepCompare?.overallConfidenceScore
          ?? enterprise.authoritativeAsset?.deepCompare?.overallConfidenceScore,
        classification: enterprise.bestDeepCompare?.classification
          ?? enterprise.authoritativeAsset?.deepCompare?.classification,
      },
    });

    /** Ownership-verified candidate only (Acceptance retainCandidate). */
    let match: VaultMatchResult | null = reportOutcome.candidate;
    const authAsset = enterprise.authoritativeAsset;
    /**
     * Comparison target may exist without ownership (Possible Similarity).
     * Never treat this as revealed owner — DNA layers still run against Top-N vault.
     */
    const comparisonMatch: VaultMatchResult | null = match
      ?? (reportOutcome.state === 'POSSIBLE' || reportOutcome.acceptanceVerdict === 'POSSIBLE_MATCH'
        ? (authAsset?.match ?? enterprise.probableMatch ?? enterprise.verifiedCandidate ?? null)
        : null);
    let revealOwner = reportOutcome.state === 'VERIFIED'
      && reportOutcome.acceptanceVerdict !== 'POSSIBLE_MATCH';

    if (comparisonMatch && authAsset) {
      assertVaultScope(authAsset.vaultId, comparisonMatch.vaultId, 'orchestrator:report_candidate');
      assertDnaScope(authAsset.dnaRecordId, comparisonMatch.dnaRecordId, 'orchestrator:report_candidate');
    }

    const retrievalConf = reportOutcome.retrievalConfidence;

    if (reportOutcome.state === 'POSSIBLE' && comparisonMatch) {
      pipeline.push(step(
        'probable_match',
        'Possible vault similarity (Top Candidates)',
        'warning',
        `${reportOutcome.displayLabel} — closest ${retrievalConf}% · vault ${comparisonMatch.vaultId.slice(0, 8)}… (owner not revealed)`,
      ));
    }

    const identityRecovery = buildIdentityRecoveryFromEnterprise(enterprise, reportOutcome);
    pipeline.push(step(
      'recovery_engines',
      'Multi-layer identity recovery',
      identityRecovery.enginesRecovered > 0 ? 'complete' : 'warning',
      identityRecovery.message,
    ));

    const liveVaultLead = liveState.snapshot?.vaultId
      ? {
          tier: 3 as const,
          method: 'live_sse_vault_lead',
          dnaRecordId: liveState.snapshot.dnaRecordId ?? '',
          vaultId: liveState.snapshot.vaultId,
          ownerUserId,
          confidence: String(liveState.snapshot.confidence ?? 0),
        }
      : null;
    const vaultSearchHit = comparisonMatch
      ?? authAsset?.match
      ?? enterprise.probableMatch
      ?? enterprise.verifiedCandidate
      ?? liveVaultLead;
    pipeline.push(step(
      'vault_search',
      'Search vault DNA records',
      vaultSearchHit ? 'complete' : 'failed',
      vaultSearchHit
        ? `Candidate tier ${vaultSearchHit.tier}: ${vaultSearchHit.method}${revealOwner ? '' : ' (owner withheld)'}`
        : 'No vault match in your account',
    ));

    // Possible Similarity with comparison target: continue pipeline without revealing owner.
    // Only go to no-match / timeout rescue when nothing to compare.
    if ((!comparisonMatch && !match) || (reportOutcome.state === 'NO_SIGNATURE' && !comparisonMatch)) {
      const liveSnapshot = liveState.snapshot;
      const rankedTop = enterprise.candidates?.[0];
      const fallbackMatch: VaultMatchResult | null = enterprise.authoritativeAsset?.match
        ?? enterprise.probableMatch
        ?? enterprise.verifiedCandidate
        ?? (rankedTop
          ? {
              tier: 3,
              method: rankedTop.method,
              dnaRecordId: rankedTop.dnaRecordId,
              vaultId: rankedTop.vaultId,
              ownerUserId,
              confidence: String(rankedTop.compositeScore),
              visualSimilarity: rankedTop.compositeScore / 100,
            }
          : null);
      const visualFromMatch = fallbackMatch
        ? Math.round((fallbackMatch.visualSimilarity ?? 0) * 100)
        : 0;
      const snapshotForPartial: InvestigationLiveSnapshot | null = liveSnapshot?.vaultId
        ? liveSnapshot
        : fallbackMatch
          ? {
              phase: 2,
              signatureFound: true,
              vaultId: fallbackMatch.vaultId,
              dnaRecordId: fallbackMatch.dnaRecordId,
              confidence: Math.max(
                liveSnapshot?.confidence ?? 0,
                Number(fallbackMatch.confidence) || 0,
                visualFromMatch,
                reportOutcome.retrievalConfidence,
                50,
              ),
              orbScore: liveSnapshot?.orbScore
                ?? enterprise.authoritativeAsset?.vector?.scores.orb
                ?? (visualFromMatch || undefined),
              similarityScore: liveSnapshot?.similarityScore
                ?? enterprise.authoritativeAsset?.vector?.scores.perceptualBlend
                ?? (visualFromMatch || undefined),
              ownerPinitId: liveSnapshot?.ownerPinitId
                ?? enterprise.authoritativeAsset?.ownerPinitId
                ?? undefined,
              originalFilename: liveSnapshot?.originalFilename
                ?? enterprise.authoritativeAsset?.originalFilename
                ?? undefined,
            }
          : null;

      if (snapshotForPartial?.vaultId) {
        const closest = Math.round(Math.max(
          snapshotForPartial.confidence ?? 0,
          snapshotForPartial.similarityScore ?? 0,
          snapshotForPartial.dnaMatchPercent ?? 0,
          rankedTop?.compositeScore ?? 0,
          Number(fallbackMatch?.confidence) || 0,
        ));
        // Weak noise / Asset Not Found: closest <50% without patch lock.
        // Mid-band L3 55–70 without patch → also Asset Not Found (anti-lookalike).
        const hasPatchLock = enterprise.authoritativeAsset?.selectionSource === 'local_patch'
          || (enterprise.authoritativeAsset?.localDnaHit?.compositeScore ?? 0) >= LOCAL_PATCH_RESCUE_MIN;
        const identityLockedRescue = enterprise.authoritativeAsset?.selectionSource === 'identity_hit'
          || enterprise.authoritativeAsset?.selectionSource === 'sha256_exact';
        const lookalikeMidBand = !hasPatchLock
          && !identityLockedRescue
          && closest < POSSIBLE_L3_MIN_WITHOUT_PATCH;
        if (reportOutcome.state === 'NO_SIGNATURE' && (closest < NOT_FOUND_MAX_WITHOUT_PATCH || lookalikeMidBand)) {
          logger.info('NO_SIGNATURE — refusing rescue for weak/lookalike similarity (Asset Not Found)', {
            vaultId: snapshotForPartial.vaultId.slice(0, 8),
            closest,
            lookalikeMidBand,
          });
          const closestOutcome = {
            ...reportOutcome,
            state: 'NO_SIGNATURE' as const,
            candidate: null,
            displayLabel: 'Unknown Asset',
            decisionReason: `No verified vault owner found. Closest similarity: ${closest}%. Manual investigation recommended.`,
            retrievalConfidence: closest,
            acceptanceConfidence: closest,
          };
          const noMatch = await this.buildNoMatchReport(
            investigationId, pipeline, leakVerify, ownerUserId, identityRecovery,
            currentFileHash, originalName, closestOutcome, enterprise, undefined, buffer, mimeType,
          );
          return this.attachPipelineAudit(noMatch, {
            probeFilename: originalName,
            probeSha256: currentFileHash,
            probeMimeType: mimeType,
            probeSizeBytes: sizeBytes,
            enterprise,
            match: null,
            originalFilename: null,
            resolvedCert: null,
            outcome: closestOutcome,
          });
        }
        logger.warn('NO_SIGNATURE / missing match — retaining vault lead as possible', {
          vaultId: snapshotForPartial.vaultId,
          confidence: snapshotForPartial.confidence,
          closest,
          fromLive: !!liveSnapshot?.vaultId,
          decision: reportOutcome.decisionReason,
        });
        return this.buildPartialFromLiveSnapshot({
          investigationId,
          pipeline,
          progressTimeline,
          currentFileHash,
          originalName,
          ownerUserId,
          snapshot: {
            ...snapshotForPartial,
            confidence: Math.max(snapshotForPartial.confidence ?? 0, closest),
          },
          error: reportOutcome.decisionReason || 'DNA verification insufficient for verified verdict',
          enterprise,
          probe: { buffer, mimeType, originalName, sizeBytes },
        });
      }
      logInvestigationDecision('no_match_report', { ...reportOutcome, candidate: null, state: 'NO_SIGNATURE' });
      const noMatch = await this.buildNoMatchReport(
        investigationId, pipeline, leakVerify, ownerUserId, identityRecovery,
        currentFileHash, originalName, reportOutcome, enterprise, undefined, buffer, mimeType,
      );
      return this.attachPipelineAudit(noMatch, {
        probeFilename: originalName,
        probeSha256: currentFileHash,
        probeMimeType: mimeType,
        probeSizeBytes: sizeBytes,
        enterprise,
        match: null,
        originalFilename: null,
        resolvedCert: null,
        outcome: reportOutcome,
      });
    }

    logInvestigationDecision('report_build_start', reportOutcome);

    emit({ type: 'timeline', stepId: 'final_report', label: 'Final Report', status: 'running' });

    // DNA/enrichment use comparison match; ownership uses revealOwner only
    if (!match && comparisonMatch) {
      match = comparisonMatch;
    }
    if (!match) {
      const noMatch = await this.buildNoMatchReport(
        investigationId, pipeline, leakVerify, ownerUserId, identityRecovery,
        currentFileHash, originalName, reportOutcome, enterprise, undefined, buffer, mimeType,
      );
      return this.attachPipelineAudit(noMatch, {
        probeFilename: originalName,
        probeSha256: currentFileHash,
        probeMimeType: mimeType,
        probeSizeBytes: sizeBytes,
        enterprise,
        match: null,
        originalFilename: null,
        resolvedCert: null,
        outcome: reportOutcome,
      });
    }

    if (rankedCandidates.length) {
      rankedCandidates = rankedCandidates.map((c) => ({
        ...c,
        // Mark Top candidate for deep compare; never imply verified ownership
        selected: c.vaultId === match!.vaultId && revealOwner,
      }));
    }

    pipeline.push(step(
      'vault_locate',
      revealOwner ? 'Locate original vault file' : 'Locate Top candidate vault file',
      'complete',
      match.vaultId,
    ));

    const [resolvedCert, dnaPrefetch] = await Promise.all([
      certificateService.findActiveForAsset({
        dnaRecordId: match.dnaRecordId,
        vaultId: match.vaultId,
        ownerUserId,
      }),
      prisma.dnaRecord.findUnique({
        where: { id: match.dnaRecordId },
        select: { createdAt: true, imageFilename: true, sha256Hash: true },
      }),
    ]);

    if (authAsset) {
      assertVaultScope(authAsset.vaultId, resolvedCert?.vaultId, 'orchestrator:certificate_lookup');
      assertDnaScope(authAsset.dnaRecordId, resolvedCert?.dnaRecordId, 'orchestrator:certificate_lookup');
      if (authAsset.certificateId && resolvedCert?.certificateId) {
        assertVaultScope(authAsset.vaultId, match.vaultId, 'orchestrator:certificate_asset');
      }
    }

    let certStatus = 'NOT_ISSUED — no certificate registered for this vault asset yet';
    if (resolvedCert) {
      const v = await certificateService.verify(resolvedCert.certificateId);
      certStatus = v.valid ? 'VALID' : v.status;
      pipeline.push(step('certificate', 'Verify certificate', v.valid ? 'complete' : 'warning', v.detail));
    } else {
      pipeline.push(step(
        'certificate',
        'Verify certificate',
        'warning',
        'No certificate issued — owner recovered via DNA/visual does not require a certificate',
      ));
    }
    const cert = resolvedCert ? { certificateId: resolvedCert.certificateId } : null;

    // 6. Authoritative 15-layer DNA comparison — reuse enterprise result when available (no duplicate compare)
    let comparison: DnaComparisonResult | null = null;
    const probeInput = { buffer, mimeType, originalName, sizeBytes };
    const cachedDeep = authAsset?.deepCompare?.layerComparisons?.length
      ? authAsset.deepCompare
      : enterprise.bestDeepCompare?.layerComparisons?.length
        ? enterprise.bestDeepCompare
        : null;

    try {
      if (!authAsset) {
        throw new Error('No authoritative asset — cannot run 15-layer DNA comparison');
      }

      assertVaultScope(authAsset.vaultId, match.vaultId, 'orchestrator:authoritative_dna_compare');
      assertDnaScope(authAsset.dnaRecordId, match.dnaRecordId, 'orchestrator:authoritative_dna_compare');

      if (investigationPerformanceConfig.skipOrchestratorRecompare && cachedDeep) {
        comparison = comparisonFromDeepCompareResult(cachedDeep, authAsset, probeInput);
        pipeline.push(step(
          'dna_compare',
          '15-layer DNA comparison',
          'complete',
          `${comparison.overallConfidenceScore}% — ${comparison.classification} · enterprise pipeline (no duplicate compare)`,
        ));
      } else {
        comparison = await withTimeoutSoft(
          () => compareProbeToAuthoritativeAsset(authAsset, probeInput, ownerUserId),
          investigationPerformanceConfig.orchestratorCompareTimeoutMs,
          'authoritative_dna_compare',
        ) ?? null;

        if (!comparison && cachedDeep) {
          comparison = comparisonFromDeepCompareResult(cachedDeep, authAsset, probeInput);
          pipeline.push(step(
            'dna_compare',
            '15-layer DNA comparison',
            'warning',
            `${comparison.overallConfidenceScore}% — cached enterprise layers (live compare timed out)`,
          ));
        } else if (comparison) {
          pipeline.push(step(
            'dna_compare',
            '15-layer DNA comparison',
            'complete',
            `${comparison.overallConfidenceScore}% — ${comparison.classification} · ${comparison.layerComparisons.length} layers compared`,
          ));
        } else {
          pipeline.push(step(
            'dna_compare',
            '15-layer DNA comparison',
            'failed',
            '15-layer compare could not complete for authoritative vault',
          ));
        }
      }

      if (comparison) {
        const cmpScore = comparison.overallConfidenceScore;
        const cmpClass = comparison.classification;
        const isCameraScan = isCameraScanFileName(originalName);
        const videoProbe = isVideoProbe;
        const identityLocked = authAsset?.selectionSource === 'identity_hit'
          || authAsset?.selectionSource === 'sha256_exact'
          || /leak verify|tep|embedded|watermark/i.test(match.method);

        // TEP / Protected Download already proved vault pairing — DNA is tamper evidence only.
        if (identityLocked || isAcceptedAfterDnaCompare(
          match,
          cmpScore,
          cmpClass,
          isCameraScan,
          retrievalConf,
          { isVideoProbe: videoProbe },
        )) {
          pipeline.push(step(
            'match_validation',
            'Validate vault match',
            'complete',
            identityLocked
              ? `${explainMatchBasis(match)} — DNA ${cmpScore}% (${cmpClass}) used for tamper only`
              : explainMatchBasis(match),
          ));
          reportOutcome = reAcceptWithDnaCompare(enterprise, match, comparison);
          logInvestigationDecision('post_dna_reaccept', reportOutcome, {
            dnaScore: cmpScore,
            classification: cmpClass,
            identityLocked,
          });
        } else {
          if (shouldRetainRetrievalCandidateAsPossible(
            enterprise, match, cmpScore, retrievalConf,
            { isVideoProbe: videoProbe },
          )) {
            reportOutcome = downgradeToPossibleAfterWeakDna(
              match,
              reportOutcome,
              cmpScore,
              cmpClass,
              { enterprise },
            );
            pipeline.push(step(
              'match_validation',
              'Validate vault match',
              'warning',
              `Weak DNA ${cmpScore}% (${cmpClass}) — retained as possible match`,
            ));
            logInvestigationDecision('match_downgraded_to_possible', reportOutcome, {
              dnaScore: cmpScore,
              classification: cmpClass,
            });
          } else {
            logger.warn('Unified investigation: match rejected after authoritative DNA comparison', {
              vaultId: match.vaultId,
              score: cmpScore,
              classification: cmpClass,
              selectionSource: enterprise.authoritativeAsset?.selectionSource,
              method: match.method,
            });
            pipeline.push(step(
              'match_validation',
              'Validate vault match',
              'failed',
              `Rejected — ${cmpScore}% DNA score does not confirm vault pairing`,
            ));
            // Acceptance Engine only — do not reuse retrieval confidence after rejection.
            const rejectedOutcome = notPinitOutcome(
              `DNA compare rejected candidate vault ${match.vaultId.slice(0, 8)}… — ${cmpScore}% ${cmpClass}`,
            );
            logInvestigationDecision('match_rejected', rejectedOutcome);
            emit({ type: 'timeline', stepId: 'final_report', label: 'Final Report', status: 'complete' });
            const liveSnapshot = liveState.snapshot;
            if (liveSnapshot?.vaultId) {
              logger.warn('DNA compare rejected but live snapshot had vault — retaining owner as possible', {
                vaultId: liveSnapshot.vaultId,
                cmpScore,
              });
              return this.buildPartialFromLiveSnapshot({
                investigationId,
                pipeline,
                progressTimeline,
                currentFileHash,
                originalName,
                ownerUserId,
                snapshot: liveSnapshot,
                error: `Vault candidate weak after 15-layer compare (${cmpScore}% — ${cmpClass})`,
                enterprise,
                probe: { buffer, mimeType, originalName, sizeBytes },
                comparison,
              });
            }
            if (match && retrievalConf >= 35) {
              return this.buildPartialFromLiveSnapshot({
                investigationId,
                pipeline,
                progressTimeline,
                currentFileHash,
                originalName,
                ownerUserId,
                snapshot: {
                  phase: 2,
                  signatureFound: true,
                  vaultId: match.vaultId,
                  dnaRecordId: match.dnaRecordId,
                  confidence: retrievalConf,
                  dnaMatchPercent: cmpScore,
                  similarityScore: liveState.snapshot?.similarityScore ?? cmpScore,
                  orbScore: liveState.snapshot?.orbScore,
                },
                error: `Vault candidate weak after 15-layer compare (${cmpScore}% — ${cmpClass})`,
                enterprise,
                probe: { buffer, mimeType, originalName, sizeBytes },
                comparison,
              });
            }
            const rejected = await this.buildNoMatchReport(
              investigationId,
              pipeline,
              leakVerify,
              ownerUserId,
              identityRecovery,
              currentFileHash,
              originalName,
              rejectedOutcome,
              undefined,
              `Vault candidate rejected after 15-layer compare (${cmpScore}% — ${cmpClass}).`,
              buffer,
              mimeType,
            );
            return this.attachPipelineAudit(rejected, {
              probeFilename: originalName,
              probeSha256: currentFileHash,
              probeMimeType: mimeType,
              probeSizeBytes: sizeBytes,
              enterprise,
              match: null,
              originalFilename: null,
              resolvedCert: null,
              outcome: rejectedOutcome,
            });
          }
        }
      }
    } catch (e) {
      logger.error('Unified investigation authoritative DNA compare failed', { error: String(e) });
      pipeline.push(step('dna_compare', '15-layer DNA comparison', 'failed', String(e)));
    }

    const resolvedDnaScore = comparison?.overallConfidenceScore;
    const identityStillLocked = enterprise.authoritativeAsset?.selectionSource === 'identity_hit'
      || enterprise.authoritativeAsset?.selectionSource === 'sha256_exact'
      || /leak verify|tep|embedded|watermark/i.test(match.method);
    // Never strip TEP / Protected Download ownership because full-frame DNA is mid-band.
    if (resolvedDnaScore != null
      && resolvedDnaScore < 50
      && reportOutcome.state === 'VERIFIED'
      && !identityStillLocked
      && shouldRetainRetrievalCandidateAsPossible(
        enterprise, match, resolvedDnaScore, retrievalConf, { isVideoProbe },
      )) {
      reportOutcome = downgradeToPossibleAfterWeakDna(
        match,
        reportOutcome,
        resolvedDnaScore,
        comparison?.classification ?? 'SIMILAR',
        { enterprise },
      );
      logInvestigationDecision('verified_downgraded_to_possible', reportOutcome, { dnaScore: resolvedDnaScore });
    }

    // Tamper localization + enrichment in parallel (same steps, lower wall-clock)
    const enrichmentMs = investigationPerformanceConfig.orchestratorEnrichmentTimeoutMs;

    let dimensionSignal: { probeWidth: number; probeHeight: number; vaultWidth: number; vaultHeight: number } | null = null;

    const tamperLocalizationPromise = (async () => {
      let scanRef = enterprise.auditContext?.forensicScan ?? null;
      if (!mimeType.startsWith('image/') || !match?.vaultId) return scanRef;
      try {
        const vaultFile = await withTimeoutSoft(
          () => vaultService.retrieve(match.vaultId, ownerUserId),
          investigationPerformanceConfig.vaultRetrieveTimeoutMs,
          'vault_retrieve_tamper',
        );
        if (vaultFile?.originalBuffer) {
          const [rescan, dims] = await Promise.all([
            withTimeoutSoft(
              () => forensicScannerService.scanProbe(buffer, mimeType, vaultFile.originalBuffer),
              30_000,
              'forensic_tamper_localize',
            ),
            withTimeoutSoft(async () => {
              const sharp = (await import('sharp')).default;
              const [probeMeta, vaultMeta] = await Promise.all([
                sharp(buffer).metadata(),
                sharp(vaultFile.originalBuffer).metadata(),
              ]);
              if (!probeMeta.width || !probeMeta.height || !vaultMeta.width || !vaultMeta.height) return null;
              return {
                probeWidth: probeMeta.width, probeHeight: probeMeta.height,
                vaultWidth: vaultMeta.width, vaultHeight: vaultMeta.height,
              };
            }, 5_000, 'dimension_compare'),
          ]);
          if (rescan?.available) scanRef = rescan;
          dimensionSignal = dims;
        }
      } catch {
        /* non-fatal */
      }
      return scanRef;
    })();

    // Fragment-reuse (spliced-region) detection is skipped only when the whole-image match
    // is verified AND that verification came from real full-frame DNA layers (crypto/
    // perceptual/structural on the whole probe) — in that case the probe is confirmed to be
    // a derivative of the whole original, so a separate fragment check adds nothing.
    // A match whose selectionSource is 'local_patch' was promoted from sparse patch votes
    // (the crop-recovery boost path) rather than a full-frame layer match — that is exactly
    // the ambiguous case a genuine small-fragment splice would also land in, so it must
    // still be checked even though the report shows VERIFIED.
    const verifiedByFullFrameMatch = reportOutcome.state === 'VERIFIED'
      && (resolvedDnaScore ?? 0) >= 70
      && authAsset?.selectionSource !== 'local_patch';
    const shouldCheckFragmentReuse = mimeType.startsWith('image/') && !verifiedByFullFrameMatch;

    const fragmentReusePromise = (async (): Promise<FragmentReuseFinding[]> => {
      if (!shouldCheckFragmentReuse) return [];
      try {
        // No excludeVaultId: the detector's own bounding-box-area filter already tells
        // apart "small isolated fragment" from "this IS the whole probe" — including the
        // already-matched vault is required precisely for the local_patch-sourced case
        // (see shouldCheckFragmentReuse above), where that vault is often the fragment's
        // real source.
        // Same budget as the whole-image local-DNA patch search (localDnaTimeoutMs) — this
        // does comparable per-patch DB + matching work, so the 12s vault-retrieve budget
        // was cutting it off before it finished, silently returning [] on every call.
        return await withTimeoutSoft(
          () => fragmentSpliceDetectorService.detectSplicedFragments(buffer, ownerUserId, mimeType),
          investigationPerformanceConfig.localDnaTimeoutMs,
          'fragment_splice_detect',
        ) ?? [];
      } catch (e) {
        logger.warn('[UnifiedInvestigation] Fragment splice detection failed', { error: String(e) });
        return [];
      }
    })();

    const [forensicScanWithRef, enrichment, fragmentReuseFindings] = await Promise.all([
      tamperLocalizationPromise,
      executeStagesParallel(
      [
        {
          name: 'access_intelligence',
          fn: () => this.loadAccessIntelligence(match.dnaRecordId, ownerUserId, leakVerify.accessHistory ?? []),
          timeoutMs: enrichmentMs,
        },
        {
          name: 'vault_row',
          fn: () => prisma.vaultRecord.findUnique({
            where: { id: match.vaultId },
            select: { originalFileName: true },
          }),
          timeoutMs: enrichmentMs,
        },
        {
          name: 'owner',
          fn: () => prisma.user.findUnique({
            where: { id: match.ownerUserId },
            select: { fullName: true, shortId: true, email: true },
          }),
          timeoutMs: enrichmentMs,
        },
        {
          name: 'leak_intelligence',
          fn: () => this.buildLeakIntelligence(match.dnaRecordId, ownerUserId),
          timeoutMs: enrichmentMs,
        },
      ],
      { onEachComplete: (r) => stageOnComplete(r.stage, formatStageLabel(r.stage))(r) },
      ),
      fragmentReusePromise,
    ]);

    // 7. Tamper analysis — fault-isolated; never throws
    const tamperStage = executeStageSync(
      'tamper_analysis',
      () => buildTamperAnalysis({
        comparison,
        leakVerify,
        mimeType,
        filename: originalName,
        fragmentReuse: fragmentReuseFindings,
        dimensions: dimensionSignal,
      }),
      { onComplete: stageOnComplete('tamper_analysis', 'Tamper Analysis') },
    );
    let tamperAnalysis = tamperStage.data ?? emptyTamperAnalysis(tamperStage.error ?? 'Tamper analysis failed');
    // Local-patch / crop recovery: ensure tamper inventory shows Crop instead of UNKNOWN
    if (
      authAsset?.selectionSource === 'local_patch'
      && (tamperAnalysis.overallTamperScore < 20 || tamperAnalysis.primaryVector === 'UNKNOWN')
    ) {
      const local = authAsset.localDnaHit;
      tamperAnalysis = buildLiveLeadTamperAnalysis({
        orbScore: local?.orbRefineScore ?? authAsset.vector?.scores.orb,
        similarityScore: authAsset.vector?.scores.perceptualBlend
          ?? comparison?.overallConfidenceScore,
        confidence: local?.compositeScore ?? comparison?.overallConfidenceScore,
        patchVotes: local?.patchMatchCount,
      });
    }

    // Mode A spatial map (64×64 → 1×1) — required for Investigate overlay UI
    tamperAnalysis = await attachSpatialAuthToTamper({
      tamperAnalysis,
      dnaRecordId: match.dnaRecordId,
      probeBuffer: buffer,
      mimeType,
      pipeline,
    });

    pipeline.push(step(
      'tamper',
      'Tamper analysis',
      tamperStage.success ? 'complete' : 'warning',
      tamperAnalysis.primaryVector,
    ));

    const accessIntelligence = (enrichment.results.access_intelligence?.data as LeakedFileAccessEntry[] | null)
      ?? leakVerify.accessHistory
      ?? [];
    const vaultRow = enrichment.results.vault_row?.data as { originalFileName: string } | null;
    let owner = enrichment.results.owner?.data as { fullName: string; shortId: string; email: string | null } | null;
    if (!owner && match.ownerUserId) {
      try {
        owner = await prisma.user.findUnique({
          where: { id: match.ownerUserId },
          select: { fullName: true, shortId: true, email: true },
        });
      } catch {
        /* non-fatal */
      }
    }
    const leakIntel = enrichment.results.leak_intelligence?.data as LeakIntelligenceSection | null
      ?? { hasPublicLeak: false, entries: [], message: 'Leak intelligence unavailable.' };
    const dnaRec = dnaPrefetch;
    const originalFilename = authAsset?.originalFilename
      ?? dnaRec?.imageFilename
      ?? vaultRow?.originalFileName
      ?? leakVerify.identity?.originalFilename;

    // 8–11. Recipient + sharing + access
    const hasShare = !!(leakVerify.shareLink || leakVerify.recipient)
      || accessIntelligence.some((a) => a.action && !a.action.startsWith('TEP_'));
    pipeline.push(step(
      'recipient',
      'Recipient attribution',
      hasShare ? 'complete' : 'skipped',
      hasShare ? 'Share lineage detected' : 'Original owner only',
    ));

    pipeline.push(step(
      'access_history',
      'Access history',
      'complete',
      `${accessIntelligence.length} events`,
    ));

    // 12. Timeline (vault audit + share + access) — time-capped enrichment
    let timelineEvents: Array<{ stage: string; timestamp?: string; detail?: string }> = [];
    const timelineBundle = await withTimeoutSoft(
      () => Promise.all([
        shareLinkService.getTimelineEvents(match.dnaRecordId, ownerUserId),
        auditService.getEventsForRecord(match.dnaRecordId),
      ]),
      enrichmentMs,
      'investigation_timeline',
    );
    if (timelineBundle) {
      const [shareTimeline, auditEvents] = timelineBundle;
      timelineEvents = this.buildTimeline({
        investigationId,
        investigatedAt: new Date().toISOString(),
        suspectFilename: originalName,
        suspectFileHash: currentFileHash,
        dnaRecordId: match.dnaRecordId,
        vaultId: match.vaultId,
        dnaMeta: dnaRec ? { createdAt: dnaRec.createdAt, filename: dnaRec.imageFilename } : null,
        shareLinks: shareTimeline,
        leakVerify,
        accessHistory: accessIntelligence,
        auditEvents,
        leakIntel,
        dnaMatchPercent: comparison?.overallConfidenceScore,
        forensicVerdict: forensicVerdictForSummary(reportOutcome),
      });
      pipeline.push(step('timeline', 'Retrieve timeline', 'complete', `${timelineEvents.length} events`));
    } else {
      pipeline.push(step('timeline', 'Retrieve timeline', 'warning', 'Timeline enrichment timed out — partial'));
      timelineEvents = this.buildTimeline({
        investigationId,
        investigatedAt: new Date().toISOString(),
        suspectFilename: originalName,
        suspectFileHash: currentFileHash,
        dnaRecordId: match.dnaRecordId,
        vaultId: match.vaultId,
        dnaMeta: dnaRec ? { createdAt: dnaRec.createdAt, filename: dnaRec.imageFilename } : null,
        shareLinks: [],
        leakVerify,
        accessHistory: accessIntelligence,
        auditEvents: [],
        leakIntel,
        dnaMatchPercent: comparison?.overallConfidenceScore,
        forensicVerdict: forensicVerdictForSummary(reportOutcome),
      });
    }

    pipeline.push(step(
      'crawler',
      'Crawler detections',
      leakIntel.hasPublicLeak ? 'warning' : 'complete',
      leakIntel.message,
    ));

    // Forensic provenance — append investigation/tamper events (DNA unchanged), then read timeline
    let evidenceTimeline: UnifiedInvestigationReport['evidenceTimeline'] = [];
    let provenanceSummary: UnifiedInvestigationReport['provenanceSummary'];
    try {
      const { forensicProvenanceService } = await import('./forensic-provenance.service');
      const tamperVectors = (tamperAnalysis.vectors ?? [])
        .filter((v) => v.detected)
        .map((v) => v.label);

      forensicProvenanceService.appendAsync({
        eventType: 'INVESTIGATED',
        summary: `Investigation — ${reportOutcome.displayLabel}`,
        dnaRecordId: match.dnaRecordId,
        vaultId: match.vaultId,
        investigationId,
        actorUserId: ownerUserId,
        payload: {
          verdict: reportOutcome.acceptanceVerdict,
          dnaMatchPercent: comparison?.overallConfidenceScore ?? 0,
          probeFilename: originalName,
          probeSha256: currentFileHash,
        },
        dedupeKey: `investigated:${investigationId}`,
      });

      if (ownerUserId) {
        import('../platform-events/module-events').then(({ emitInvestigationCompleted }) => {
          emitInvestigationCompleted({
            ownerUserId,
            investigationId,
            dnaRecordId: match.dnaRecordId,
            vaultId: match.vaultId,
            verdict: reportOutcome.displayLabel,
            filename: originalName,
          });
        }).catch(() => {});
      }

      if (tamperVectors.length > 0 || (comparison?.tamperingDetected && (comparison.overallConfidenceScore ?? 100) < 95)) {
        forensicProvenanceService.appendAsync({
          eventType: 'TAMPERED',
          summary: `Tamper indicators — ${tamperAnalysis.primaryVector ?? 'detected'}`,
          dnaRecordId: match.dnaRecordId,
          vaultId: match.vaultId,
          investigationId,
          payload: {
            primaryVector: tamperAnalysis.primaryVector,
            overallTamperScore: tamperAnalysis.overallTamperScore,
            vectors: tamperVectors,
          },
          dedupeKey: `tampered:${investigationId}`,
        });
        if (ownerUserId) {
          import('../platform-events/extended-events').then(({ emitAiTamperingDetected }) => {
            emitAiTamperingDetected({
              ownerUserId,
              dnaRecordId: match.dnaRecordId,
              investigationId,
              filename: originalName,
              vector: tamperAnalysis.primaryVector ?? undefined,
            });
          }).catch(() => {});
        }
      }

      const provenanceEvents = await withTimeoutSoft(
        () => forensicProvenanceService.getTimeline({
          dnaRecordId: match.dnaRecordId,
          vaultId: match.vaultId,
        }),
        enrichmentMs,
        'forensic_provenance',
      ) ?? [];

      evidenceTimeline = provenanceEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        summary: e.summary,
        timestamp: e.timestamp,
        locationLabel: e.locationLabel,
        actorLabel: e.actorLabel,
        device: e.device,
        tepCode: e.tepCode,
        certificateId: e.certificateId,
        source: e.source,
      }));
      provenanceSummary = forensicProvenanceService.buildSummary(provenanceEvents);
      pipeline.push(step(
        'provenance',
        'Evidence timeline',
        'complete',
        `${evidenceTimeline.length} custody events`,
      ));
    } catch (err) {
      logger.warn('Forensic provenance enrichment failed (non-fatal)', { error: String(err) });
      pipeline.push(step('provenance', 'Evidence timeline', 'warning', 'Provenance unavailable'));
    }

    // 14. Report
    pipeline.push(step('report', 'Generate investigation report', 'complete'));

    const localPatchScore = authAsset?.localDnaHit?.compositeScore ?? 0;
    const dnaPct = Math.max(
      comparison?.overallConfidenceScore ?? 0,
      authAsset?.selectionSource === 'local_patch' && localPatchScore >= 55 ? localPatchScore : 0,
    );
    // Refresh ownership gate after DNA re-acceptance
    revealOwner = reportOutcome.state === 'VERIFIED'
      && (reportOutcome.acceptanceVerdict === 'VERIFIED_ORIGINAL'
        || reportOutcome.acceptanceVerdict === 'VERIFIED_DERIVATIVE');

    const resolvedOwnerPinitId = authAsset?.ownerPinitId ?? owner?.shortId ?? null;
    const resolvedOwnerName = owner?.fullName ?? owner?.shortId ?? authAsset?.ownerPinitId ?? null;
    const resolvedVaultId = authAsset?.vaultId ?? match.vaultId;
    const resolvedDnaRecordId = authAsset?.dnaRecordId ?? match.dnaRecordId;
    const resolvedCertId = cert?.certificateId
      ?? authAsset?.certificateId
      ?? (resolvedVaultId
        ? `CERT-DNA-${resolvedVaultId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
        : resolvedDnaRecordId
          ? `CERT-DNA-${resolvedDnaRecordId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
          : null);
    const resolvedOriginalFilename = originalFilename
      ?? authAsset?.originalFilename
      ?? dnaRec?.imageFilename
      ?? null;

    const identityFromVault = revealOwner ? resolvedOwnerPinitId : null;
    const retrievalConfidence = reportOutcome.retrievalConfidence;
    const ownershipVerification = enterprise.fusion.ownershipVerificationConfidence;
    const forensicVerdict = forensicVerdictForSummary(reportOutcome);
    const forensicReasons = buildForensicReasons(enterprise, originalName, certStatus);

    const identityStatus = mapIdentityStatus(
      enterprise, leakVerify, identityFromVault, retrievalConfidence,
    );

    const trustScore = Math.max(enterprise.fusion.trustScore, identityRecovery.compositeScores.trustScore);
    // Identity recovery must include DNA/visual when watermark missing (fusion already does this)
    const identityConfidence = Math.max(
      enterprise.fusion.identityConfidence,
      identityRecovery.compositeScores.identityConfidence,
      dnaPct >= 55 ? Math.round(dnaPct * 0.85) : 0,
      Math.round((reportOutcome.retrievalConfidence ?? 0) * 0.75),
    );
    // Ownership ≠ retrieval. Keep certificate/vault ownership score separate from DNA retrieval.
    const ownershipConf = Math.max(
      ownershipVerification,
      identityFromVault && retrievalConfidence >= 50
        ? Math.round(45 + Math.min(retrievalConfidence, dnaPct || retrievalConfidence) * 0.35)
        : 0,
    );

    const evidenceConf = evidenceConfidenceService.compute(
      dnaPct,
      (comparison?.layerComparisons ?? []).slice(0, 6).map((l) => ({
        layer: l.name.toLowerCase().replace(/\s+/g, '_'),
        score: l.similarityScore,
        weight: 0.15,
        passed: l.matched,
      })),
      tamperAnalysis.primaryVector as never,
      certStatus === 'VALID',
      identityConfidence / 100,
    );
    // Evidence confidence must track fused recovery — never report 100% while identity is ~33%
    const fusedEvidence = Math.round(
      retrievalConfidence * 0.35 + identityConfidence * 0.40 + ownershipConf * 0.25,
    );
    const alignedEvidenceConfidence = Math.round(
      Math.min(
        100,
        evidenceConf
          ? evidenceConf.trustScore * 0.35 + fusedEvidence * 0.65
          : fusedEvidence,
      ),
    );

    const reportMessage = revealOwner
      ? `${reportOutcome.displayLabel}. ${reportOutcome.decisionReason}${forensicReasons.length ? ` Reason: ${forensicReasons.join('; ')}.` : ''}`
      : (reportOutcome.decisionReason.startsWith('No verified vault owner')
        ? reportOutcome.decisionReason
        : `No verified vault owner found. Closest similarity: ${Math.round(retrievalConfidence || dnaPct || reportOutcome.acceptanceConfidence || 0)}%. Manual investigation recommended.`);

    logInvestigationDecision('final_report', reportOutcome, { dnaMatchPercent: dnaPct, certificateStatus: certStatus, revealOwner });

    const summary = {
      ownershipConfidence: revealOwner ? ownershipConf : 0,
      retrievalConfidence,
      ownershipVerificationConfidence: revealOwner ? ownershipConf : 0,
      forensicVerdict,
      reportState: revealOwner ? reportOutcome.state : (reportOutcome.state === 'POSSIBLE' ? 'POSSIBLE' : reportOutcome.state),
      decisionReason: reportMessage,
      forensicReasons: forensicReasons.length ? forensicReasons : undefined,
      dnaMatchPercent: dnaPct,
      certificateStatus: revealOwner
        ? certStatus
        : (reportOutcome.state === 'POSSIBLE' && resolvedCertId
          ? 'ACTIVE — candidate cert (ownership pending verify)'
          : reportOutcome.state === 'POSSIBLE'
            ? 'CANDIDATE — registrant shown; ownership pending verify'
            : certStatus),
      identityStatus: revealOwner ? identityStatus : (reportOutcome.state === 'POSSIBLE' ? 'FOUND' : 'NOT_VERIFIED'),
      tamperSeverity: tamperAnalysis.primaryVector,
      riskLevel: reportOutcome.state === 'POSSIBLE'
        ? 'MEDIUM'
        : riskFromScores(dnaPct, tamperAnalysis.overallTamperScore, revealOwner),
      trustScore: revealOwner ? trustScore : Math.min(trustScore, retrievalConfidence),
      identityConfidence: revealOwner ? identityConfidence : Math.min(identityConfidence, retrievalConfidence),
      acceptanceVerdict: reportOutcome.acceptanceVerdict,
      acceptancePolicyVersion: reportOutcome.acceptancePolicyVersion,
      acceptanceConfidence: reportOutcome.acceptanceConfidence,
    };

    const identityRecoveryReport = revealOwner
      ? this.buildIdentityRecoveryReport({
        match: {
          ...match,
          vaultId: resolvedVaultId,
          dnaRecordId: resolvedDnaRecordId,
        },
        owner: owner
          ? { ...owner, shortId: resolvedOwnerPinitId ?? owner.shortId }
          : (resolvedOwnerPinitId
            ? { fullName: resolvedOwnerName ?? resolvedOwnerPinitId, shortId: resolvedOwnerPinitId, email: null }
            : null),
        dnaRec,
        cert: resolvedCertId ? { certificateId: resolvedCertId } : cert,
        leakVerify,
        currentFileHash,
        ownershipConf,
        accessIntelligence,
        evidenceConf,
        originalFilename: resolvedOriginalFilename,
        alignedEvidenceConfidence,
        certStatus,
      })
      : {
        recovered: false,
        // Candidate vault registrant — display for review; verdict stays POSSIBLE until Verified
        originalOwner: reportOutcome.state === 'POSSIBLE' ? (resolvedOwnerName ?? null) : null,
        ownerPinitId: reportOutcome.state === 'POSSIBLE' ? (resolvedOwnerPinitId ?? null) : null,
        vaultId: reportOutcome.state === 'POSSIBLE' ? resolvedVaultId : undefined,
        dnaRecordId: reportOutcome.state === 'POSSIBLE' ? resolvedDnaRecordId : undefined,
        certificateId: reportOutcome.state === 'POSSIBLE' ? (resolvedCertId ?? null) : null,
        originalFilename: reportOutcome.state === 'POSSIBLE'
          ? (resolvedOriginalFilename ?? undefined)
          : undefined,
        createdAt: reportOutcome.state === 'POSSIBLE'
          ? dnaRec?.createdAt?.toISOString()
          : undefined,
        protectedDownloadDate: undefined,
        originalDevice: undefined,
        registrationTimestamp: reportOutcome.state === 'POSSIBLE'
          ? dnaRec?.createdAt?.toISOString()
          : undefined,
        originalHash: reportOutcome.state === 'POSSIBLE'
          ? (dnaRec?.sha256Hash ?? undefined)
          : undefined,
        currentHash: currentFileHash,
        evidenceConfidence: Math.round(retrievalConfidence || dnaPct || 0),
        message: reportMessage,
      };

    const layerAnalysis = (comparison?.layerComparisons ?? []).map((l) => ({
      layer: l.layer,
      name: l.name,
      matchPercent: l.skipped ? 0 : l.similarityPercent,
      status: layerStatus(l.similarityPercent, l.skipped),
      explanation: l.changeDescription,
    }));

    if (rankedCandidates.length && comparison) {
      const sel = rankedCandidates.find((c) => c.selected);
      if (sel) sel.dnaMatchPercent = dnaPct;
    }

    const forensicScan = forensicScanWithRef;
    const matchReasons = buildExplainableMatchReasons({
      forensicScan,
      dnaComparison: comparison,
      watermarkDetected: !!leakVerify.watermark?.code,
    });
    const mergedReasons = [
      ...(forensicScan?.matchReasons ?? []),
      ...matchReasons.filter((r) => !forensicScan?.matchReasons?.some((m) => m.signal === r.signal)),
    ].sort((a, b) => b.percent - a.percent);

    if (forensicScan?.tamperLocalization?.overlayPngBase64) {
      tamperAnalysis.overlayPngBase64 = forensicScan.tamperLocalization.overlayPngBase64;
      tamperAnalysis.modifiedPercent = forensicScan.tamperLocalization.modifiedPercent;
      tamperAnalysis.insertedRegions = forensicScan.tamperLocalization.insertedRegions;
      if (forensicScan.tamperLocalization.regions?.length) {
        tamperAnalysis.regions = forensicScan.tamperLocalization.regions as TamperAnalysisSection['regions'];
      }
      if (forensicScan.tamperLocalization.description) {
        tamperAnalysis.description = [
          tamperAnalysis.description,
          forensicScan.tamperLocalization.description,
        ].filter(Boolean).join(' · ');
      }
    }
    if (forensicScan?.cropDetection) {
      tamperAnalysis.cropDetection = {
        sharedRegionPercent: forensicScan.cropDetection.sharedRegionPercent,
        visiblePercent: forensicScan.cropDetection.visiblePercent,
        cropPercent: forensicScan.cropDetection.cropPercent,
        missingPercent: forensicScan.cropDetection.missingPercent,
        homographyFound: forensicScan.cropDetection.homographyFound,
      };
      // Surface crop geometry as an explicit "what changed" row when scanner found it
      const cropPct = forensicScan.cropDetection.cropPercent
        ?? forensicScan.cropDetection.missingPercent;
      const shared = forensicScan.cropDetection.sharedRegionPercent
        ?? forensicScan.cropDetection.visiblePercent;
      if (cropPct != null || shared != null) {
        const existing = tamperAnalysis.changesVsOriginal ?? [];
        const already = existing.some((c) => c.type === 'Crop');
        if (!already) {
          tamperAnalysis.changesVsOriginal = [
            {
              type: 'Crop',
              detected: true,
              confidence: forensicScan.cropDetection.homographyFound ? 80 : 60,
              detail: [
                shared != null ? `Shared region with original: ~${Math.round(shared)}%` : null,
                cropPct != null ? `Cropped / missing area: ~${Math.round(cropPct)}%` : null,
              ].filter(Boolean).join(' · ') || 'Crop geometry detected vs vault original',
              where: 'Spatial alignment (homography) vs vault original frame',
            },
            ...existing,
          ];
        } else {
          tamperAnalysis.changesVsOriginal = existing.map((c) =>
            c.type === 'Crop'
              ? {
                  ...c,
                  where: c.where ?? 'Spatial alignment vs vault original frame',
                  detail: [
                    c.detail,
                    shared != null ? `Shared region ~${Math.round(shared)}%` : null,
                    cropPct != null ? `Missing/cropped ~${Math.round(cropPct)}%` : null,
                  ].filter(Boolean).join(' · '),
                }
              : c,
          );
        }
        const cropVec = tamperAnalysis.vectors.find((v) => v.label === 'Crop');
        if (cropVec) {
          cropVec.detected = true;
          cropVec.confidence = Math.max(cropVec.confidence ?? 0, 60);
          cropVec.evidence = [
            ...(cropVec.evidence ?? []),
            shared != null ? `Shared region ~${Math.round(shared)}%` : '',
            cropPct != null ? `Cropped/missing ~${Math.round(cropPct)}%` : '',
          ].filter(Boolean);
        }
      }
    }

    const forensicEvidence = buildForensicEvidenceSection({
      forensicScan,
      matchReasons: mergedReasons,
      ownerName: owner?.fullName ?? null,
      vaultId: match.vaultId,
      dnaRecordId: match.dnaRecordId,
      certificateId: cert?.certificateId ?? authAsset?.certificateId ?? null,
      uploadDate: dnaRec?.createdAt?.toISOString(),
      watermarkDetected: !!leakVerify.watermark?.code,
      distributionPlatforms: leakIntel.entries.map((e) => e.platform),
    });

    logger.info('Unified investigation complete', {
      investigationId,
      dnaRecordId: match.dnaRecordId,
      totalMs: orchestratorTimer.totalMs(),
    });
    orchestratorTimer.logSummary('UnifiedInvestigation');

    emit({ type: 'timeline', stepId: 'final_report', label: 'Final Report', status: 'complete', elapsedMs: orchestratorTimer.totalMs() });

    const stageTimings = [
      ...(enterprise.stageTimings ?? []),
      ...orchestratorTimer.getTimings(),
    ];

    const authorizationStatus = resolveAuthorizationStatus(true, leakVerify);
    await recordLineageEdge({
      currentFileHash,
      matchedDnaRecordId: match.dnaRecordId,
      classification: comparison?.classification ?? 'SIMILAR',
      confidence: dnaPct,
      changedLayers: (comparison?.layerComparisons ?? []).filter((l) => l.changed).map((l) => l.name),
      primaryTamperVector: tamperAnalysis.primaryVector,
      fragmentDetected: fragmentReuseFindings.length > 0,
      fragmentConfidence: fragmentReuseFindings[0]?.confidence ?? null,
    });
    const relatedLineage = await documentLineageService.getLineage(match.dnaRecordId).catch(() => ({ nodes: [], edges: [] }));

    const report: UnifiedInvestigationReport = {
      success: true,
      investigationId,
      investigatedAt: new Date().toISOString(),
      pipeline,
      summary,
      message: reportMessage,
      owner: revealOwner
        ? {
          ownerName: resolvedOwnerName,
          ownerPinitId: resolvedOwnerPinitId,
          vaultId: resolvedVaultId,
          dnaRecordId: resolvedDnaRecordId,
          certificateId: resolvedCertId,
          originalFilename: resolvedOriginalFilename ?? undefined,
          createdAt: dnaRec?.createdAt?.toISOString(),
        }
        : {
          // POSSIBLE: surface vault registrant + cert for review (claim still not Verified)
          ownerName: reportOutcome.state === 'POSSIBLE' ? (resolvedOwnerName ?? null) : null,
          ownerPinitId: reportOutcome.state === 'POSSIBLE' ? (resolvedOwnerPinitId ?? null) : null,
          vaultId: reportOutcome.state === 'POSSIBLE' ? resolvedVaultId : undefined,
          dnaRecordId: reportOutcome.state === 'POSSIBLE' ? resolvedDnaRecordId : undefined,
          certificateId: reportOutcome.state === 'POSSIBLE' ? (resolvedCertId ?? null) : null,
          originalFilename: reportOutcome.state === 'POSSIBLE'
            ? (resolvedOriginalFilename ?? undefined)
            : undefined,
          createdAt: reportOutcome.state === 'POSSIBLE'
            ? dnaRec?.createdAt?.toISOString()
            : undefined,
        },
      recipientAttribution: this.buildRecipientSection(leakVerify, accessIntelligence),
      dnaComparison: comparison,
      layerAnalysis,
      tamperAnalysis,
      timeline: timelineEvents,
      evidenceTimeline,
      provenanceSummary,
      accessIntelligence,
      leakIntelligence: leakIntel,
      identityProof: {
        vaultId: resolvedVaultId,
        dnaRecordId: resolvedDnaRecordId,
        certificateId: revealOwner || reportOutcome.state === 'POSSIBLE' || !!resolvedVaultId
          ? (resolvedCertId ?? undefined)
          : undefined,
        ownerPinitId: revealOwner || reportOutcome.state === 'POSSIBLE'
          ? (resolvedOwnerPinitId ?? undefined)
          : undefined,
        digitalSignatureValid: !!leakVerify.valid
          || !!revealOwner
          || (reportOutcome.state === 'POSSIBLE' && !!resolvedVaultId && ownershipConf >= 50),
        watermark: resolveWatermarkProof(leakVerify, {
          vaultId: resolvedVaultId,
          ownerPinitId: revealOwner
            ? (resolvedOwnerPinitId ?? undefined)
            : undefined,
          ownershipRecovered: !!identityFromVault || (revealOwner && ownershipConf >= 50),
          dnaMatchPercent: dnaPct,
          visualScore: Math.round((match.visualSimilarity ?? 0) * 100)
            || enterprise.authoritativeAsset?.vector?.scores.orb
            || undefined,
        }),
        identityVerification: leakVerify.valid
          ? 'PASSED'
          : identityFromVault
            ? `VAULT_OWNER:${identityFromVault}`
            : leakVerify.found
              ? 'DAMAGED'
              : 'NOT_FOUND',
      },
      leakVerify: {
        found: leakVerify.found,
        valid: leakVerify.valid,
        tampered: leakVerify.tampered,
        detectionMethod: leakVerify.detectionMethod,
        leakVector: leakVerify.leakVector,
        confidence: leakVerify.confidence,
        message: leakVerify.message,
        accessHistory: accessIntelligence,
      },
      matchTier: match.tier,
      matchMethod: dnaPct > 0
        ? `${match.method.replace(/, DNA \d+%/g, '')} · final DNA ${dnaPct}%`
        : match.method,
      identityRecovery,
      candidateRanking: rankedCandidates.length ? rankedCandidates : undefined,
      identityRecoveryReport,
      forensicEvidence,
      currentFileHash,
      stageTimings,
      progressTimeline,
      fragmentReuseAnalysis: buildFragmentReuseSection(fragmentReuseFindings),
      provenance: { authorizationStatus },
      relatedLineage,
    };

    return this.attachPipelineAudit(report, {
      probeFilename: originalName,
      probeSha256: currentFileHash,
      probeMimeType: mimeType,
      probeSizeBytes: sizeBytes,
      enterprise,
      match,
      originalFilename,
      resolvedCert,
      outcome: reportOutcome,
    });

    } catch (fatalErr) {
      logger.error('[UnifiedInvestigation] Fatal error — returning fault-tolerant report', {
        error: String(fatalErr),
        investigationId,
      });
      if (ownerUserId) {
        import('../platform-events/extended-events').then(({ emitInvestigationFailed }) => {
          emitInvestigationFailed({
            ownerUserId,
            investigationId,
            filename: originalName,
            reason: fatalErr instanceof Error ? fatalErr.message : String(fatalErr),
          });
        }).catch(() => {});
      }
      emit({ type: 'timeline', stepId: 'final_report', label: 'Final Report', status: 'warning' });
      return this.buildFaultTolerantReport({
        investigationId,
        pipeline,
        progressTimeline,
        currentFileHash,
        originalName,
        leakVerify: null,
        error: fatalErr instanceof Error ? fatalErr.message : String(fatalErr),
      });
    } finally {
      endInvestigationWork();
    }
  }

  /** Attach immutable Investigation Manifest (Phase 2 — single source of truth). */
  private sealWithManifest(
    report: UnifiedInvestigationReport,
    outcome: InvestigationOutcome,
    probe: {
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256?: string;
    },
    candidateLogs?: import('./candidate-ranking-engine.service').CandidateRankingLog[],
  ): UnifiedInvestigationReport {
    const manifest = buildInvestigationManifest({
      report,
      outcome,
      probeFilename: probe.filename,
      probeMimeType: probe.mimeType,
      probeSizeBytes: probe.sizeBytes,
      probeSha256: probe.sha256 ?? report.currentFileHash,
      candidateLogs: candidateLogs?.map((l) => ({
        rank: l.rank,
        vaultId: l.vaultId,
        filename: l.filename,
        vectorSimilarity: l.vectorSimilarity,
        clipSimilarity: l.clipSimilarity,
        orbScore: l.orbScore,
        pHashSimilarity: l.pHashSimilarity,
        dnaScore: l.dnaScore,
        dnaClassification: l.dnaClassification,
        fusionScore: l.fusionScore,
        decision: l.decision === 'FILTERED' ? 'REJECT' as const : l.decision,
        rejectReasons: l.rejectReasons,
      })),
    });
    return { ...report, manifest };
  }

  private async attachPipelineAudit(
    report: UnifiedInvestigationReport,
    params: {
      probeFilename: string;
      probeSha256: string;
      probeMimeType: string;
      probeSizeBytes: number;
      enterprise: EnterpriseRecoveryResult;
      match: VaultMatchResult | null;
      originalFilename?: string | null;
      resolvedCert?: { certificateId: string; dnaRecordId?: string; vaultId?: string } | null;
      outcome?: InvestigationOutcome;
    },
  ): Promise<UnifiedInvestigationReport> {
    const sealed = params.outcome
      ? this.sealWithManifest(
          report,
          params.outcome,
          {
            filename: params.probeFilename,
            mimeType: params.probeMimeType,
            sizeBytes: params.probeSizeBytes,
            sha256: params.probeSha256,
          },
          params.enterprise.auditContext?.candidateRankingLogs,
        )
      : report;

    const ctx = params.enterprise.auditContext;
    if (!ctx) {
      logger.warn('[PipelineAudit] No auditContext on enterprise result — trace omitted');
      return sealed;
    }
    report = sealed;

    const reportConsistency = auditReportConsistency({
      reportVaultId: report.owner?.vaultId,
      reportDnaRecordId: report.owner?.dnaRecordId,
      reportCertificateId: report.owner?.certificateId ?? report.identityProof?.certificateId,
      reportOriginalFilename: report.owner?.originalFilename ?? params.originalFilename,
      verifiedCandidate: params.enterprise.authoritativeAsset?.match ?? params.enterprise.verifiedCandidate,
      matchAfterOverride: null,
      enterpriseCertificateId: params.enterprise.authoritativeAsset?.certificateId ?? params.enterprise.certificateId,
      bestDeepCompare: params.enterprise.bestDeepCompare,
      resolvedCertificate: params.resolvedCert
        ? {
            certificateId: params.resolvedCert.certificateId,
            dnaRecordId: params.resolvedCert.dnaRecordId,
            vaultId: params.resolvedCert.vaultId,
          }
        : null,
    });

    const auth = params.enterprise.authoritativeAsset;
    let pipelineAudit: InvestigationPipelineAudit;
    try {
      pipelineAudit = await buildInvestigationPipelineAudit(
        {
          probeFilename: params.probeFilename,
          probeSha256: params.probeSha256,
          probeMimeType: params.probeMimeType,
          probeSizeBytes: params.probeSizeBytes,
          vaultRecordIds: ctx.vaultRecordIds,
          vectors: ctx.vectors,
          candidates: params.enterprise.candidates,
          deepCompareResults: params.enterprise.deepCompareResults,
          localDnaHit: ctx.localDnaHit,
          identityHit: ctx.identityHit,
          verifiedCandidate: auth?.match ?? params.enterprise.verifiedCandidate,
          matchBeforeOverride: null,
          matchAfterOverride: null,
          certificateId: auth?.certificateId ?? params.enterprise.certificateId,
          certificateLookupVaultId: auth?.vaultId,
          selectionSteps: ctx.selectionSteps,
        },
        reportConsistency,
      );
    } catch (e) {
      logger.error('[PipelineAudit] Failed to build trace', { error: String(e) });
      return report;
    }

    return { ...report, pipelineAudit };
  }

  private buildIdentityRecoveryReport(params: {
    match: VaultMatchResult;
    owner: { fullName: string; shortId: string; email: string | null } | null;
    dnaRec: { createdAt: Date; imageFilename: string; sha256Hash?: string | null } | null;
    cert: { certificateId: string } | null;
    leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>>;
    currentFileHash: string;
    ownershipConf: number;
    accessIntelligence: LeakedFileAccessEntry[];
    evidenceConf?: ReturnType<typeof evidenceConfidenceService.compute>;
    originalFilename?: string | null;
    alignedEvidenceConfidence?: number;
    certStatus?: string;
  }): IdentityRecoveryReportSection {
    const {
      match, owner, dnaRec, cert, leakVerify, currentFileHash, ownershipConf,
      accessIntelligence, evidenceConf, originalFilename, alignedEvidenceConfidence, certStatus,
    } = params;
    const protectedDl = accessIntelligence.find((a) =>
      a.tepCode || a.action?.includes('PROTECTED') || a.action?.includes('TEP_EXPORT'),
    );
    const device = accessIntelligence.find((a) => a.device)?.device;
    const evidencePct = alignedEvidenceConfidence
      ?? evidenceConf?.trustScore
      ?? ownershipConf;
    const tepFromLeak = (leakVerify as { tep?: { code?: string } }).tep?.code
      ?? (leakVerify as { tepCode?: string }).tepCode;

    return {
      recovered: ownershipConf >= 50,
      originalOwner: owner?.fullName ?? owner?.shortId ?? null,
      ownerPinitId: owner?.shortId ?? null,
      vaultId: match.vaultId,
      dnaRecordId: match.dnaRecordId,
      certificateId: cert?.certificateId
        ?? (certStatus?.startsWith('NOT_ISSUED')
          ? 'NOT_ISSUED — no certificate on this vault asset yet'
          : null),
      originalFilename: originalFilename ?? dnaRec?.imageFilename ?? undefined,
      createdAt: dnaRec?.createdAt?.toISOString(),
      tepCode: protectedDl?.tepCode ?? tepFromLeak ?? null,
      protectedDownloadDate: protectedDl?.timestamp,
      originalDevice: device,
      registrationTimestamp: leakVerify.identity?.dnaCreatedAt ?? dnaRec?.createdAt?.toISOString(),
      originalHash: dnaRec?.sha256Hash ?? undefined,
      currentHash: currentFileHash,
      evidenceConfidence: evidencePct,
      message: ownershipConf >= 50
        ? 'Original identity recovered from multi-layer forensic signals'
        : 'Partial recovery — confidence below enterprise threshold',
    };
  }

  /**
   * Load vault session timeline + chain-of-custody provenance for a matched asset.
   */
  private async enrichVaultTimeline(input: {
    investigationId: string;
    investigatedAt: string;
    suspectFilename: string;
    suspectFileHash: string;
    dnaRecordId: string;
    vaultId: string;
    ownerUserId: string;
    dnaMeta: { createdAt: Date; filename: string } | null;
    dnaMatchPercent?: number;
    forensicVerdict?: string;
    investigationSummary?: string;
  }): Promise<{
    timelineEvents: UnifiedInvestigationReport['timeline'];
    evidenceTimeline: UnifiedInvestigationReport['evidenceTimeline'];
    provenanceSummary: UnifiedInvestigationReport['provenanceSummary'];
    accessIntelligence: LeakedFileAccessEntry[];
    leakIntel: LeakIntelligenceSection;
  }> {
    const enrichmentMs = Math.max(
      investigationPerformanceConfig.orchestratorEnrichmentTimeoutMs,
      20_000,
    );

    const leakVerifyStub = {
      found: true,
      valid: false,
      tampered: false,
      message: input.investigationSummary ?? 'Investigation match',
      accessHistory: [] as LeakedFileAccessEntry[],
    };

    const [timelineBundle, accessIntelligence, leakIntel] = await Promise.all([
      withTimeoutSoft(
        () => Promise.all([
          shareLinkService.getTimelineEvents(input.dnaRecordId, input.ownerUserId),
          auditService.getEventsForRecord(input.dnaRecordId),
        ]),
        enrichmentMs,
        'investigation_timeline',
      ),
      withTimeoutSoft(
        () => this.loadAccessIntelligence(input.dnaRecordId, input.ownerUserId, []),
        enrichmentMs,
        'access_intelligence',
      ),
      withTimeoutSoft(
        () => this.buildLeakIntelligence(input.dnaRecordId, input.ownerUserId),
        enrichmentMs,
        'leak_intel',
      ),
    ]);

    const [shareTimeline, auditEvents] = timelineBundle ?? [[], []];
    const accessRows = accessIntelligence ?? [];
    const leakRows = leakIntel ?? { hasPublicLeak: false, entries: [], message: 'No public crawler detections' };

    const timelineEvents = this.buildTimeline({
      investigationId: input.investigationId,
      investigatedAt: input.investigatedAt,
      suspectFilename: input.suspectFilename,
      suspectFileHash: input.suspectFileHash,
      dnaRecordId: input.dnaRecordId,
      vaultId: input.vaultId,
      dnaMeta: input.dnaMeta,
      shareLinks: shareTimeline,
      leakVerify: leakVerifyStub,
      accessHistory: accessRows,
      auditEvents,
      leakIntel: leakRows,
      dnaMatchPercent: input.dnaMatchPercent,
      forensicVerdict: input.forensicVerdict,
    });

    const { forensicProvenanceService } = await import('./forensic-provenance.service');
    forensicProvenanceService.appendAsync({
      eventType: 'INVESTIGATED',
      summary: `Investigation — ${input.investigationSummary ?? 'vault match'}`,
      dnaRecordId: input.dnaRecordId,
      vaultId: input.vaultId,
      investigationId: input.investigationId,
      actorUserId: input.ownerUserId,
      payload: {
        probeFilename: input.suspectFilename,
        probeSha256: input.suspectFileHash,
        dnaMatchPercent: input.dnaMatchPercent ?? 0,
      },
      dedupeKey: `investigated:${input.investigationId}`,
    });

    const provenanceEvents = await withTimeoutSoft(
      () => forensicProvenanceService.getTimeline({
        dnaRecordId: input.dnaRecordId,
        vaultId: input.vaultId,
      }),
      enrichmentMs,
      'forensic_provenance',
    ) ?? [];

    const evidenceTimeline = provenanceEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      summary: e.summary,
      timestamp: e.timestamp,
      locationLabel: e.locationLabel,
      actorLabel: e.actorLabel,
      device: e.device,
      tepCode: e.tepCode,
      certificateId: e.certificateId,
      source: e.source,
    }));

    const provenanceSummary = forensicProvenanceService.buildSummary(provenanceEvents);

    return {
      timelineEvents,
      evidenceTimeline,
      provenanceSummary,
      accessIntelligence: accessRows,
      leakIntel: leakRows,
    };
  }

  /**
   * When enterprise recovery times out after live SSE already located a vault,
   * return a POSSIBLE report so scanner/upload UI keeps owner + vault details.
   */
  private async buildPartialFromLiveSnapshot(params: {
    investigationId: string;
    pipeline: InvestigationPipelineStep[];
    progressTimeline: InvestigationProgressEvent[];
    currentFileHash: string;
    originalName: string;
    ownerUserId: string;
    snapshot: InvestigationLiveSnapshot;
    error: string;
    enterprise?: EnterpriseRecoveryResult;
    probe?: { buffer: Buffer; mimeType: string; originalName: string; sizeBytes: number };
    comparison?: DnaComparisonResult | null;
  }): Promise<UnifiedInvestigationReport> {
    const { snapshot } = params;
    const vaultId = snapshot.vaultId!;
    // Never invent floors (was max(..., 30) / max(conf, 40)) — that turned weak
    // lookalike leads into "Original Found — Derivative Detected" (false positives).
    const liveConf = Math.max(0, snapshot.confidence ?? 0);
    let comparison = params.comparison ?? null;
    let realDna: number | undefined =
      typeof snapshot.dnaMatchPercent === 'number' ? snapshot.dnaMatchPercent : undefined;
    if (comparison?.overallConfidenceScore != null && (realDna == null || realDna < comparison.overallConfidenceScore)) {
      realDna = comparison.overallConfidenceScore;
    }

    // Post-timeout rescue: finish 15-layer DNA against the live vault (crops often
    // already have ORB/similarity — recovery just ran out of wall-clock time).
    // Strong live leads (≥90%) already verified identity — skip heavy DNA regeneration
    // so the investigation report can render immediately (tamper paths for mid-band
    // crops still run the rescue below).
    const strongLiveIdentity = liveConf >= 90 && !!snapshot.signatureFound;
    if (
      !strongLiveIdentity
      && (!comparison || (realDna ?? 0) < 40)
      && params.probe
      && (snapshot.dnaRecordId || params.enterprise?.authoritativeAsset?.dnaRecordId)
    ) {
      const dnaRecordIdHint = snapshot.dnaRecordId
        ?? params.enterprise!.authoritativeAsset!.dnaRecordId;
      try {
        const authAsset = {
          vaultId,
          dnaRecordId: dnaRecordIdHint,
          ownerUserId: params.ownerUserId,
          ownerPinitId: snapshot.ownerPinitId ?? params.enterprise?.authoritativeAsset?.ownerPinitId ?? null,
          certificateId: params.enterprise?.authoritativeAsset?.certificateId ?? null,
          originalFilename: snapshot.originalFilename
            ?? params.enterprise?.authoritativeAsset?.originalFilename
            ?? params.originalName,
          storagePath: params.enterprise?.authoritativeAsset?.storagePath ?? null,
          selectionSource: 'local_patch' as const,
          match: {
            tier: 3 as const,
            method: 'live_timeout_rescue',
            dnaRecordId: dnaRecordIdHint,
            vaultId,
            ownerUserId: params.ownerUserId,
            confidence: String(liveConf),
            visualSimilarity: (snapshot.similarityScore ?? liveConf) / 100,
          },
          rankedCandidate: null,
          vector: null,
          deepCompare: null,
          localDnaHit: null,
        };
        const rescued = await withTimeoutSoft(
          () => compareProbeToAuthoritativeAsset(authAsset, params.probe!, params.ownerUserId),
          Math.max(investigationPerformanceConfig.orchestratorCompareTimeoutMs, 30_000),
          'post_timeout_dna_compare',
        );
        if (rescued) {
          comparison = rescued;
          realDna = rescued.overallConfidenceScore;
          params.pipeline.push(step(
            'dna_compare',
            '15-layer DNA comparison',
            'complete',
            `${rescued.overallConfidenceScore}% — post-timeout rescue`,
          ));
        }
      } catch (err) {
        logger.warn('[PartialReport] Post-timeout DNA compare failed', { error: String(err) });
      }
    } else if (strongLiveIdentity && !comparison) {
      params.pipeline.push(step(
        'dna_compare',
        '15-layer DNA comparison',
        'warning',
        `Strong live identity ${Math.round(liveConf)}% — report sealed without post-timeout DNA regen`,
      ));
      if (typeof snapshot.dnaMatchPercent === 'number') {
        realDna = snapshot.dnaMatchPercent;
      } else {
        realDna = liveConf;
      }
    }

    const hasRealDna = typeof realDna === 'number' && realDna >= 40;
    const fusionOwnership = params.enterprise?.fusion.ownershipVerificationConfidence ?? 0;
    const fusionIdentity = params.enterprise?.fusion.identityConfidence ?? 0;
    const fusionTrust = params.enterprise?.fusion.trustScore ?? 0;
    const orbScore = snapshot.orbScore ?? 0;
    const similarityScore = snapshot.similarityScore ?? liveConf;
    const patchVotes = snapshot.patchVotes ?? 0;
    // Do NOT treat mid-band similarity alone (50–70%) as crop — that surfaces unrelated lookalikes.
    const cropLikeLead = patchVotes >= 3
      || (orbScore >= 70 && similarityScore >= POSSIBLE_L3_MIN_WITHOUT_PATCH);

    const vaultRow = await prisma.vaultRecord.findFirst({
      where: { id: vaultId, dnaRecord: { ownerUserId: params.ownerUserId } },
      include: {
        dnaRecord: {
          select: {
            id: true,
            imageFilename: true,
            createdAt: true,
            sha256Hash: true,
            ownerUser: { select: { fullName: true, shortId: true } },
          },
        },
      },
    });

    const dnaRecordId = vaultRow?.dnaRecordId
      ?? snapshot.dnaRecordId
      ?? params.enterprise?.authoritativeAsset?.dnaRecordId
      ?? undefined;
    const ownerName = vaultRow?.dnaRecord?.ownerUser?.fullName
      ?? snapshot.ownerName
      ?? null;
    const ownerPinitId = vaultRow?.dnaRecord?.ownerUser?.shortId
      ?? snapshot.ownerPinitId
      ?? params.enterprise?.authoritativeAsset?.ownerPinitId
      ?? null;
    const originalFilename = vaultRow?.originalFileName
      ?? snapshot.originalFilename
      ?? params.enterprise?.authoritativeAsset?.originalFilename
      ?? undefined;

    const hasResolvableVault = !!vaultRow;
    const hasOwnerLead = !!(ownerName || ownerPinitId);
    /**
     * Live path must NEVER invent ownership from a mid-band lookalike.
     * Policy: L3 55–70 without patch → Asset Not Found (not Top Candidate).
     * Only surface POSSIBLE when DNA/patch/identity or strong L3 (≥70) confirms.
     */
    const retainOwnerLead = false;
    const liveLeadScore = Math.max(
      liveConf,
      similarityScore,
      orbScore,
      patchVotes >= 3 ? LOCAL_PATCH_RESCUE_MIN : 0,
    );
    const liveIdentityLocked = params.enterprise?.authoritativeAsset?.selectionSource === 'identity_hit'
      || params.enterprise?.authoritativeAsset?.selectionSource === 'sha256_exact'
      || params.enterprise?.watermarkRecovered === true;
    const strongVisualLead = liveLeadScore >= POSSIBLE_L3_MIN_WITHOUT_PATCH
      && (orbScore >= 55 || similarityScore >= POSSIBLE_L3_MIN_WITHOUT_PATCH || patchVotes >= 3);
    const showCandidateLead = !!vaultId
      && (hasOwnerLead || hasResolvableVault)
      && (
        liveIdentityLocked
        || (hasRealDna && (realDna ?? 0) >= POSSIBLE_MIN)
        || patchVotes >= 3
        || cropLikeLead
        || strongVisualLead
      );
    const displayConf = showCandidateLead
      ? Math.max(liveConf, similarityScore, realDna ?? 0, fusionOwnership, fusionIdentity, fusionTrust)
      : 0;

    let certificateId: string | undefined;
    if (dnaRecordId) {
      const cert = await prisma.certificate.findFirst({
        where: { vaultId, dnaRecordId, status: 'ACTIVE' },
        orderBy: { issuedAt: 'desc' },
        select: { certificateId: true },
      });
      certificateId = cert?.certificateId;
    }

    params.pipeline.push(step(
      'identity',
      'Extract embedded identity',
      'warning',
      hasRealDna
        ? `Live DNA retained — vault ${vaultId.slice(0, 8)}… (${realDna}%)`
        : cropLikeLead
          ? `Crop/compress live lead ${vaultId.slice(0, 8)}… — ORB ${Math.round(orbScore)}% · sim ${Math.round(similarityScore)}%`
          : `Unconfirmed live lead ${vaultId.slice(0, 8)}… — DNA not completed`,
    ));
    params.pipeline.push(step(
      'report',
      'Generate investigation report',
      'warning',
      hasRealDna || cropLikeLead
        ? 'Partial report with vault match retained'
        : `Partial report — recovery incomplete`,
    ));

    // Acceptance only verifies when phase-3 DNA actually completed.
    // Weak vector leads (~30%) must not become VERIFIED_DERIVATIVE.
    // Live vault leads (≥40%) feed visual + candidate so verdict can be POSSIBLE_MATCH.
    // Exception: TEP / Protected Download watermark already proved ownership on the live path.
    const liveWmScore = Math.max(
      0,
      ...(params.enterprise?.recoveredSignals ?? [])
        .filter((s) => /watermark|identity_token|manifest|tep/i.test(s.stage) && s.recovered)
        .map((s) => s.score),
      params.enterprise?.fusion?.ownershipVerificationConfidence ?? 0,
      liveConf,
    );
    const decision = runAcceptanceEngine({
      analysisComplete: hasRealDna || showCandidateLead || liveIdentityLocked,
      hasCandidate: hasRealDna || showCandidateLead || liveIdentityLocked,
      vaultId: hasRealDna || showCandidateLead || liveIdentityLocked ? vaultId : undefined,
      dnaRecordId: hasRealDna || showCandidateLead || liveIdentityLocked ? dnaRecordId : undefined,
      ownerUserId: params.ownerUserId,
      ownerPinitId: liveIdentityLocked ? (ownerPinitId ?? undefined) : undefined,
      dna: liveIdentityLocked
        ? passChannel(Math.max(realDna ?? 0, liveWmScore, 90), 'identity_hit_tep')
        : hasRealDna
          ? passChannel(realDna!, 'completed_deep_dna')
          : showCandidateLead && liveLeadScore >= LOCAL_PATCH_RESCUE_MIN
            ? passChannel(Math.round(liveLeadScore), 'live_vault_lead')
            : failChannel(liveConf, 'deep_dna_not_completed'),
      certificate: certificateId && hasRealDna && (realDna ?? 0) >= 90
        ? passChannel(100, certificateId)
        : certificateId
          ? passChannel(50, certificateId)
          : skippedChannel('No certificate'),
      vault: hasRealDna || showCandidateLead || liveIdentityLocked
        ? passChannel(100, vaultId)
        : failChannel(0, 'unconfirmed_live_lead'),
      owner: liveIdentityLocked && liveWmScore >= 85
        ? passChannel(Math.max(90, liveWmScore), 'identity_hit_tep')
        : failChannel(0, 'Ownership not cryptographically bound on live/timeout path'),
      timeline: hasRealDna || liveIdentityLocked
        ? passChannel(40)
        : showCandidateLead
          ? passChannel(40, 'live_vault_present')
          : failChannel(0, 'incomplete'),
      visual: hasRealDna && liveConf >= 40
        ? passChannel(liveConf)
        : showCandidateLead || liveIdentityLocked
          ? passChannel(Math.max(liveConf, similarityScore, 40), 'live_retrieval_lead')
          : failChannel(liveConf, 'visual_unconfirmed'),
      watermark: liveIdentityLocked && liveWmScore >= 85
        ? passChannel(Math.max(90, liveWmScore), 'watermark_tep_leak_verify')
        : failChannel(0),
      metadata: skippedChannel(),
      tamperDetected: hasRealDna || cropLikeLead,
      failureReason: hasRealDna || showCandidateLead || liveIdentityLocked ? undefined : params.error,
    });

    const conf = Math.max(displayConf, liveLeadScore);

    // Fragment-reuse (spliced-region) check — a partial/weak whole-image match doesn't
    // rule out a small fragment of a DIFFERENT protected original being spliced into this
    // probe; this is exactly the report shape that scenario tends to land in.
    let fragmentReuseFindings: FragmentReuseFinding[] = [];
    if (params.probe?.buffer && params.probe.mimeType?.startsWith('image/')) {
      try {
        fragmentReuseFindings = await withTimeoutSoft(
          () => fragmentSpliceDetectorService.detectSplicedFragments(
            params.probe!.buffer, params.ownerUserId, params.probe!.mimeType,
          ),
          investigationPerformanceConfig.localDnaTimeoutMs,
          'fragment_splice_detect_partial',
        ) ?? [];
      } catch (e) {
        logger.warn('[PartialReport] Fragment splice detection failed', { error: String(e) });
      }
    }

    // Prefer layer DNA for tamper; else synthesize Crop/Compress from live ORB/similarity
    const leakStub = {
      found: true as const,
      valid: false,
      tampered: true,
      message: 'Live vault derivative',
      accessHistory: [] as LeakedFileAccessEntry[],
    };
    let tamperAnalysis = comparison
      ? buildTamperAnalysis({
        comparison,
        leakVerify: leakStub,
        mimeType: params.probe?.mimeType,
        filename: params.originalName,
      })
      : buildLiveLeadTamperAnalysis({
        orbScore: snapshot.orbScore,
        similarityScore: snapshot.similarityScore ?? liveConf,
        confidence: liveConf,
        patchVotes: snapshot.patchVotes,
        timedOut: /timed out/i.test(params.error),
        originalHash: vaultRow?.dnaRecord?.sha256Hash,
        currentHash: params.currentFileHash,
      });
    if (cropLikeLead && !tamperAnalysis.vectors.some((v) => v.label === 'Crop' && v.detected)) {
      const liveCrop = buildLiveLeadTamperAnalysis({
        orbScore: snapshot.orbScore,
        similarityScore: snapshot.similarityScore ?? liveConf,
        confidence: liveConf,
        patchVotes: snapshot.patchVotes,
        timedOut: /timed out/i.test(params.error),
        originalHash: vaultRow?.dnaRecord?.sha256Hash,
        currentHash: params.currentFileHash,
      });
      tamperAnalysis = {
        ...liveCrop,
        overallTamperScore: Math.max(liveCrop.overallTamperScore, tamperAnalysis.overallTamperScore),
        changesVsOriginal: [
          ...(liveCrop.changesVsOriginal ?? []),
          ...(tamperAnalysis.changesVsOriginal ?? []).filter(
            (c) => !(liveCrop.changesVsOriginal ?? []).some((x) => x.type === c.type),
          ),
        ],
      };
    }

    // Partial / timeout reports must still get the spatial overlay when possible
    tamperAnalysis = await attachSpatialAuthToTamper({
      tamperAnalysis,
      dnaRecordId,
      probeBuffer: params.probe?.buffer,
      mimeType: params.probe?.mimeType,
      pipeline: params.pipeline,
    });

    if (fragmentReuseFindings.length) {
      const top = fragmentReuseFindings[0]!;
      tamperAnalysis = {
        ...tamperAnalysis,
        vectors: [
          ...tamperAnalysis.vectors.filter((v) => v.label !== 'Spliced Fragment'),
          {
            label: 'Spliced Fragment',
            detected: true,
            confidence: top.confidence,
            evidence: [`${top.patchMatchCount} matching patches found in a localized region of this image`],
          },
        ],
        changesVsOriginal: [
          {
            type: 'Spliced Fragment',
            detected: true,
            confidence: top.confidence,
            detail: 'A protected original\'s content appears composited into a localized region of this image.',
            where: `Region at ~${Math.round(top.probeRegion.xPercent)}%,${Math.round(top.probeRegion.yPercent)}% of the uploaded image`,
          },
          ...(tamperAnalysis.changesVsOriginal ?? []),
        ],
      };
    }

    params.pipeline.push(step(
      'tamper',
      'Tamper analysis',
      tamperAnalysis.overallTamperScore > 0 ? 'complete' : 'warning',
      tamperAnalysis.primaryVector,
    ));

    // Do not promote lookalikes (mid-band ~55–69%) to POSSIBLE Top Candidate.
    let reportState: 'VERIFIED' | 'POSSIBLE' | 'NO_SIGNATURE' = mapAcceptanceToReportState(decision.verdict);
    if (
      reportState === 'NO_SIGNATURE'
      && showCandidateLead
      && conf >= POSSIBLE_L3_MIN_WITHOUT_PATCH
    ) {
      reportState = 'POSSIBLE';
    }

    const investigatedAt = new Date().toISOString();

    let timelineEvents: UnifiedInvestigationReport['timeline'] = [];
    let evidenceTimeline: UnifiedInvestigationReport['evidenceTimeline'] = [];
    let provenanceSummary: UnifiedInvestigationReport['provenanceSummary'];
    let accessIntelligence: LeakedFileAccessEntry[] = [];
    let leakIntel: LeakIntelligenceSection = {
      hasPublicLeak: false,
      entries: [],
      message: 'No public crawler detections for this asset',
    };

    if ((retainOwnerLead || hasRealDna || showCandidateLead) && dnaRecordId && vaultId) {
      try {
        const enriched = await this.enrichVaultTimeline({
          investigationId: params.investigationId,
          investigatedAt,
          suspectFilename: params.originalName,
          suspectFileHash: params.currentFileHash,
          dnaRecordId,
          vaultId,
          ownerUserId: params.ownerUserId,
          dnaMeta: vaultRow?.dnaRecord
            ? { createdAt: vaultRow.dnaRecord.createdAt, filename: vaultRow.dnaRecord.imageFilename }
            : null,
          dnaMatchPercent: hasRealDna ? realDna! : liveConf,
          forensicVerdict: reportState === 'POSSIBLE' ? 'POSSIBLE_ASSET' : undefined,
          investigationSummary: decision.displayLabel,
        });
        timelineEvents = enriched.timelineEvents;
        evidenceTimeline = enriched.evidenceTimeline;
        provenanceSummary = enriched.provenanceSummary;
        accessIntelligence = enriched.accessIntelligence;
        leakIntel = enriched.leakIntel;
        params.pipeline.push(step('timeline', 'Retrieve timeline', 'complete', `${timelineEvents.length} events`));
        params.pipeline.push(step(
          'provenance',
          'Evidence timeline',
          'complete',
          `${evidenceTimeline?.length ?? 0} custody events`,
        ));
      } catch (err) {
        logger.warn('[PartialReport] Timeline enrichment failed', { error: String(err) });
        timelineEvents = this.buildTimeline({
          investigationId: params.investigationId,
          investigatedAt,
          suspectFilename: params.originalName,
          suspectFileHash: params.currentFileHash,
          dnaRecordId,
          vaultId,
          dnaMeta: vaultRow?.dnaRecord
            ? { createdAt: vaultRow.dnaRecord.createdAt, filename: vaultRow.dnaRecord.imageFilename }
            : null,
          shareLinks: [],
          leakVerify: { found: false, valid: false, tampered: false, message: '', accessHistory: [] },
          accessHistory: [],
          auditEvents: [],
          dnaMatchPercent: hasRealDna ? realDna! : liveConf,
          forensicVerdict: 'POSSIBLE_ASSET',
        });
      }
    }

    if (
      timelineEvents.length === 0
      && (retainOwnerLead || hasRealDna || showCandidateLead)
      && dnaRecordId
      && vaultId
    ) {
      timelineEvents = this.buildTimeline({
        investigationId: params.investigationId,
        investigatedAt,
        suspectFilename: params.originalName,
        suspectFileHash: params.currentFileHash,
        dnaRecordId,
        vaultId,
        dnaMeta: vaultRow?.dnaRecord
          ? { createdAt: vaultRow.dnaRecord.createdAt, filename: vaultRow.dnaRecord.imageFilename }
          : null,
        shareLinks: [],
        leakVerify: {
          found: true,
          valid: false,
          tampered: false,
          message: 'Live vault match',
          accessHistory: accessIntelligence,
        },
        accessHistory: accessIntelligence,
        auditEvents: [],
        dnaMatchPercent: hasRealDna ? realDna! : liveConf,
        forensicVerdict: 'POSSIBLE_ASSET',
      });
    }

    const ownerBlock = decision.retainCandidate
      ? {
          ownerName,
          ownerPinitId,
          vaultId,
          dnaRecordId,
          certificateId,
          originalFilename,
          createdAt: vaultRow?.dnaRecord?.createdAt?.toISOString(),
        }
      : reportState === 'POSSIBLE' && showCandidateLead
        ? {
            // Candidate vault registrant for review — verdict remains POSSIBLE
            ownerName,
            ownerPinitId,
            vaultId,
            dnaRecordId,
            certificateId,
            originalFilename,
            createdAt: vaultRow?.dnaRecord?.createdAt?.toISOString(),
          }
        : {
            ownerName: null,
            ownerPinitId: null,
            vaultId: undefined,
            dnaRecordId: undefined,
            certificateId: undefined,
            originalFilename: undefined,
          };

    const closestLive = Math.round(Math.max(liveConf, similarityScore, realDna ?? 0));
    const partialReviewNote = `No verified vault owner found. Closest similarity: ${closestLive}%. Manual investigation recommended.`;

    const dnaDisplay = hasRealDna
      ? realDna!
      : (showCandidateLead ? Math.round(Math.max(similarityScore, liveConf, conf, POSSIBLE_MIN)) : 0);

    if (
      (!comparison || !comparison.layerComparisons?.length)
      && params.enterprise
      && params.probe
      && dnaRecordId
    ) {
      const cachedDeep = params.enterprise.authoritativeAsset?.deepCompare?.layerComparisons?.length
        ? params.enterprise.authoritativeAsset.deepCompare
        : params.enterprise.bestDeepCompare?.layerComparisons?.length
          ? params.enterprise.bestDeepCompare
          : null;
      if (cachedDeep) {
        try {
          comparison = comparisonFromDeepCompareResult(
            cachedDeep,
            {
              vaultId,
              dnaRecordId,
              ownerUserId: params.ownerUserId,
              ownerPinitId: ownerPinitId ?? null,
              certificateId: certificateId ?? null,
              originalFilename: originalFilename ?? params.originalName,
              storagePath: params.enterprise.authoritativeAsset?.storagePath ?? null,
              selectionSource: 'local_patch',
              match: {
                tier: 2,
                method: 'enterprise_cached_deep',
                dnaRecordId,
                vaultId,
                ownerUserId: params.ownerUserId,
                confidence: String(liveConf),
                visualSimilarity: (snapshot.similarityScore ?? liveConf) / 100,
              },
              rankedCandidate: null,
              vector: null,
              deepCompare: cachedDeep,
              localDnaHit: null,
            },
            params.probe,
          );
          realDna = comparison.overallConfidenceScore;
          params.pipeline.push(step(
            'dna_compare',
            '15-layer DNA comparison',
            'warning',
            `${comparison.overallConfidenceScore}% — enterprise cached layers (timeout path)`,
          ));
        } catch (err) {
          logger.warn('[PartialReport] Cached deep compare mapping failed', { error: String(err) });
        }
      }
    }

    let layerAnalysis = (comparison?.layerComparisons ?? []).map((l) => ({
      layer: l.layer,
      name: l.name,
      matchPercent: l.skipped ? 0 : l.similarityPercent,
      status: layerStatus(l.similarityPercent, l.skipped),
      explanation: l.changeDescription,
    }));

    if (layerAnalysis.length === 0 && (hasRealDna || showCandidateLead)) {
      layerAnalysis = buildLiveLeadLayerAnalysis({
        dnaPct: dnaDisplay || liveConf,
        orbScore: snapshot.orbScore,
        simScore: snapshot.similarityScore ?? liveConf,
        originalHash: vaultRow?.dnaRecord?.sha256Hash ?? undefined,
        currentHash: params.currentFileHash,
      });
      params.pipeline.push(step(
        'dna_compare',
        '15-layer DNA analysis',
        'warning',
        `${layerAnalysis.length} layers estimated from live recovery (${Math.round(liveConf)}% confidence)`,
      ));
    }

    const tepResolved = await this.resolveTepForInvestigation({
      vaultId,
      dnaRecordId,
      ownerUserId: params.ownerUserId,
      probe: params.probe,
      accessIntelligence,
      evidenceTimeline,
    });

    const authorizationStatus = resolveAuthorizationStatus(true, { tep: tepResolved.tepCode ? { code: tepResolved.tepCode } : null });
    if (params.currentFileHash && dnaRecordId) {
      await recordLineageEdge({
        currentFileHash: params.currentFileHash,
        matchedDnaRecordId: dnaRecordId,
        classification: comparison?.classification ?? 'SIMILAR',
        confidence: dnaDisplay,
        changedLayers: (comparison?.layerComparisons ?? []).filter((l) => l.changed).map((l) => l.name),
        primaryTamperVector: tamperAnalysis.primaryVector,
        fragmentDetected: fragmentReuseFindings.length > 0,
        fragmentConfidence: fragmentReuseFindings[0]?.confidence ?? null,
      });
    }
    const relatedLineage = dnaRecordId
      ? await documentLineageService.getLineage(dnaRecordId).catch(() => ({ nodes: [], edges: [] }))
      : { nodes: [], edges: [] };

    const report: UnifiedInvestigationReport = {
      success: reportState !== 'NO_SIGNATURE',
      investigationId: params.investigationId,
      investigatedAt,
      pipeline: params.pipeline,
      summary: {
        ownershipConfidence: decision.retainCandidate ? conf : 0,
        retrievalConfidence: decision.retainCandidate || reportState === 'POSSIBLE'
          ? Math.max(conf, closestLive, dnaDisplay)
          : 0,
        ownershipVerificationConfidence: decision.retainCandidate ? Math.max(conf, fusionOwnership) : 0,
        forensicVerdict: reportState === 'POSSIBLE' ? 'POSSIBLE_ASSET' : mapAcceptanceToForensicVerdict(decision.verdict),
        reportState,
        decisionReason: decision.retainCandidate
          ? decision.decisionReason
          : partialReviewNote,
        dnaMatchPercent: dnaDisplay,
        certificateStatus: decision.retainCandidate && certificateId
          ? 'ACTIVE'
          : reportState === 'POSSIBLE' && certificateId
            ? 'ACTIVE — candidate cert (ownership pending verify)'
            : 'NOT_REVEALED — owner withheld until verified',
        identityStatus: decision.retainCandidate
          ? (ownerPinitId ? 'PARTIALLY_RECOVERED' : 'FOUND')
          : reportState === 'POSSIBLE'
            ? 'FOUND'
            : 'NOT_VERIFIED',
        tamperSeverity: tamperAnalysis.primaryVector,
        riskLevel: decision.retainCandidate || reportState === 'POSSIBLE' ? 'MEDIUM' : 'UNKNOWN',
        trustScore: decision.retainCandidate
          ? Math.max(conf, fusionTrust)
          : Math.max(conf, closestLive, dnaDisplay),
        identityConfidence: decision.retainCandidate
          ? Math.max(conf, fusionIdentity)
          : Math.max(conf, closestLive, dnaDisplay),
        acceptanceVerdict: reportState === 'POSSIBLE' ? 'POSSIBLE_MATCH' : decision.verdict,
      },
      message: decision.retainCandidate
        ? (hasRealDna
          ? `Deep DNA ${realDna}% (vault ${vaultId.slice(0, 8)}…) — ${decision.displayLabel}`
          : decision.displayLabel)
        : partialReviewNote,
      owner: ownerBlock,
      recipientAttribution: {
        fromShare: false,
        message: 'Original Owner Only — no share recipient attribution.',
      },
      dnaComparison: comparison,
      layerAnalysis,
      tamperAnalysis,
      fragmentReuseAnalysis: buildFragmentReuseSection(fragmentReuseFindings),
      provenance: { authorizationStatus },
      relatedLineage,
      timeline: timelineEvents,
      evidenceTimeline,
      provenanceSummary,
      accessIntelligence,
      leakIntelligence: leakIntel,
      identityProof: {
        vaultId: showCandidateLead || retainOwnerLead || hasRealDna ? vaultId : undefined,
        dnaRecordId: showCandidateLead || retainOwnerLead || hasRealDna ? dnaRecordId : undefined,
        certificateId: showCandidateLead || retainOwnerLead || hasRealDna
          ? (certificateId
            ?? (vaultId
              ? `CERT-DNA-${vaultId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
              : dnaRecordId
                ? `CERT-DNA-${dnaRecordId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
                : undefined))
          : undefined,
        ownerPinitId: showCandidateLead || retainOwnerLead || hasRealDna
          ? (ownerPinitId ?? undefined)
          : undefined,
        digitalSignatureValid: retainOwnerLead || hasRealDna || showCandidateLead,
        identityVerification: retainOwnerLead || hasRealDna
          ? 'PARTIALLY_RECOVERED'
          : showCandidateLead
            ? 'CANDIDATE_VAULT'
            : 'NOT_FOUND',
        watermark: resolveWatermarkProof(
          {
            found: hasRealDna || retainOwnerLead || showCandidateLead,
            valid: retainOwnerLead || hasRealDna,
            tampered: !(retainOwnerLead || hasRealDna),
            message: 'Live / timeout path',
          },
          {
            vaultId: showCandidateLead || retainOwnerLead || hasRealDna ? vaultId : undefined,
            ownerPinitId: showCandidateLead || retainOwnerLead || hasRealDna
              ? (ownerPinitId ?? undefined)
              : undefined,
            ownershipRecovered: retainOwnerLead || hasRealDna,
            dnaMatchPercent: dnaDisplay,
            visualScore: Math.round(liveConf),
          },
        ),
      },
      leakVerify: {
        found: hasRealDna,
        message: hasRealDna
          ? 'Identity DNA-verified before stage timeout'
          : 'Live lead not DNA-verified',
        accessHistory: [],
      },
      identityRecovery: {
        enginesRun: 1,
        enginesRecovered: hasRealDna ? 1 : (retainOwnerLead ? 1 : 0),
        signals: [{
          engine: 'live_snapshot',
          label: 'Live identity recovery',
          score: conf,
          weight: 1,
          weightedContribution: conf,
          status: hasRealDna ? 'recovered' : (retainOwnerLead ? 'partial' : 'failed'),
          detail: hasRealDna
            ? `Vault ${vaultId.slice(0, 8)}… DNA ${realDna}% before timeout`
            : retainOwnerLead
              ? `Vault ${vaultId.slice(0, 8)}… owner ${ownerPinitId ?? ownerName} — conf ${Math.round(liveConf)}%`
              : `Unconfirmed lead ${vaultId.slice(0, 8)}… conf ${liveConf}% — ${params.error}`,
        }],
        compositeScores: {
          ownershipConfidence: conf,
          trustScore: Math.max(conf, fusionTrust),
          identityConfidence: Math.max(conf, fusionIdentity),
        },
        transformations: [],
        message: reportState === 'POSSIBLE'
          ? REPORT_STATE_LABELS.POSSIBLE
          : decision.displayLabel,
      },
      identityRecoveryReport: {
        recovered: hasRealDna || (retainOwnerLead && conf >= 50) || (reportState === 'POSSIBLE' && showCandidateLead),
        originalOwner: showCandidateLead || retainOwnerLead || hasRealDna ? ownerName : null,
        ownerPinitId: showCandidateLead || retainOwnerLead || hasRealDna ? ownerPinitId : null,
        vaultId: showCandidateLead || retainOwnerLead || hasRealDna ? vaultId : undefined,
        dnaRecordId: showCandidateLead || retainOwnerLead || hasRealDna ? dnaRecordId : undefined,
        certificateId: showCandidateLead || retainOwnerLead || hasRealDna ? (certificateId ?? null) : null,
        originalFilename: showCandidateLead || retainOwnerLead || hasRealDna ? originalFilename : undefined,
        createdAt: vaultRow?.dnaRecord?.createdAt?.toISOString(),
        registrationTimestamp: vaultRow?.dnaRecord?.createdAt?.toISOString(),
        originalHash: vaultRow?.dnaRecord?.sha256Hash ?? undefined,
        currentHash: params.currentFileHash,
        evidenceConfidence: conf,
        tepCode: tepResolved.tepCode ?? null,
        protectedDownloadDate: tepResolved.protectedDownloadDate,
        message: hasRealDna
          ? 'Identity DNA-verified from live investigation snapshot before timeout'
          : reportState === 'POSSIBLE'
            ? `Possible vault candidate ${vaultId.slice(0, 8)}… — registrant ${ownerPinitId ?? 'unknown'}; ownership claim pending verification`
            : retainOwnerLead
              ? `Possible owner identified from live recovery — ${ownerName ?? ownerPinitId}; manual DNA review recommended`
              : `Unconfirmed live lead ${vaultId.slice(0, 8)}… — deep DNA did not complete; not an original match`,
      },
      matchTier: hasRealDna ? 2 : (retainOwnerLead ? 3 : undefined),
      matchMethod: hasRealDna
        ? 'Live identity recovery (DNA before timeout)'
        : retainOwnerLead
          ? 'Live identity recovery (owner retained — DNA incomplete)'
          : 'Unconfirmed live lead (DNA incomplete)',
      currentFileHash: params.currentFileHash,
      progressTimeline: params.progressTimeline,
    };

    const outcome: InvestigationOutcome = {
      state: mapAcceptanceToReportState(decision.verdict),
      candidate: decision.retainCandidate
        ? {
            tier: 2,
            method: 'Live identity recovery (DNA before timeout)',
            vaultId,
            dnaRecordId: dnaRecordId ?? '',
            ownerUserId: params.ownerUserId,
            confidence: String(conf),
          }
        : null,
      retrievalConfidence: decision.retrievalConfidence,
      forensicVerdict: mapAcceptanceToForensicVerdict(decision.verdict),
      displayLabel: decision.displayLabel,
      decisionReason: decision.decisionReason,
      acceptanceVerdict: decision.verdict,
      acceptancePolicyVersion: decision.acceptancePolicyVersion,
      dnaAlgorithmVersion: decision.dnaAlgorithmVersion,
      acceptanceConfidence: decision.confidence,
      acceptanceScorecard: decision.scorecard,
    };

    return this.sealWithManifest(report, outcome, {
      filename: params.originalName,
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      sha256: params.currentFileHash,
    });
  }

  private buildFaultTolerantReport(params: {
    investigationId: string;
    pipeline: InvestigationPipelineStep[];
    progressTimeline: InvestigationProgressEvent[];
    currentFileHash: string;
    originalName: string;
    leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>> | null;
    error: string;
  }): UnifiedInvestigationReport {
    const investigatedAt = new Date().toISOString();
    const acceptance = insufficientEvidenceOutcome(params.error);
    logInvestigationDecision('insufficient_evidence', acceptance);
    params.pipeline.push(step('report', 'Generate investigation report', 'warning', acceptance.displayLabel));
    const safeError = sanitizeInvestigationError(params.error);
    const leakVerify = params.leakVerify ?? {
      found: false,
      valid: false,
      tampered: false,
      message: safeError,
      accessHistory: [],
    };

    const report: UnifiedInvestigationReport = {
      success: false,
      investigationId: params.investigationId,
      investigatedAt,
      pipeline: params.pipeline,
      summary: {
        ownershipConfidence: 0,
        retrievalConfidence: 0,
        ownershipVerificationConfidence: 0,
        forensicVerdict: acceptance.forensicVerdict,
        reportState: acceptance.state,
        decisionReason: acceptance.decisionReason,
        dnaMatchPercent: 0,
        certificateStatus: 'UNKNOWN',
        identityStatus: 'NOT_FOUND',
        tamperSeverity: 'UNKNOWN',
        riskLevel: 'UNKNOWN',
        trustScore: 0,
        identityConfidence: 0,
        acceptanceVerdict: acceptance.acceptanceVerdict,
        acceptancePolicyVersion: acceptance.acceptancePolicyVersion,
        acceptanceConfidence: acceptance.acceptanceConfidence,
      },
      message: acceptance.displayLabel,
      owner: {
        ownerName: null,
        ownerPinitId: null,
        vaultId: undefined,
        dnaRecordId: undefined,
        certificateId: undefined,
        originalFilename: undefined,
        createdAt: undefined,
      },
      recipientAttribution: this.buildRecipientSection(leakVerify),
      layerAnalysis: [],
      tamperAnalysis: emptyTamperAnalysis(params.error),
      timeline: [],
      accessIntelligence: leakVerify.accessHistory ?? [],
      leakIntelligence: { hasPublicLeak: false, entries: [], message: 'Unavailable' },
      identityProof: {
        digitalSignatureValid: false,
        identityVerification: 'NOT_FOUND',
        watermark: resolveWatermarkProof(leakVerify, {}),
      },
      leakVerify: {
        found: leakVerify.found,
        message: leakVerify.message,
        accessHistory: leakVerify.accessHistory,
      },
      identityRecovery: {
        enginesRun: 0,
        enginesRecovered: 0,
        signals: [],
        compositeScores: { ownershipConfidence: 0, trustScore: 0, identityConfidence: 0 },
        transformations: [],
        message: acceptance.displayLabel,
      },
      currentFileHash: params.currentFileHash,
      progressTimeline: params.progressTimeline,
    };

    return this.sealWithManifest(report, acceptance, {
      filename: params.originalName,
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      sha256: params.currentFileHash,
    });
  }

  private async buildNoMatchReport(
    investigationId: string,
    pipeline: InvestigationPipelineStep[],
    leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>>,
    _ownerUserId: string,
    identityRecovery: IdentityRecoverySection | undefined,
    currentFileHash: string | undefined,
    suspectFilename: string,
    outcome: InvestigationOutcome,
    enterprise?: EnterpriseRecoveryResult,
    customMessage?: string,
    probeBuffer?: Buffer,
    probeMimeType?: string,
  ): Promise<UnifiedInvestigationReport> {
    // A whole-image match failed, but the probe may still contain a spliced-in
    // fragment of a protected original (e.g. a small region composited into an
    // otherwise-unrelated photo) — check before finalizing a bare "no match".
    let fragmentReuseFindings: FragmentReuseFinding[] = [];
    if (probeBuffer && probeMimeType && _ownerUserId) {
      try {
        fragmentReuseFindings = await fragmentSpliceDetectorService.detectSplicedFragments(
          probeBuffer, _ownerUserId, probeMimeType,
        );
      } catch (e) {
        logger.warn('[UnifiedInvestigation] Fragment splice detection failed (no-match path)', { error: String(e) });
      }
    }
    const noSignatureOutcome: InvestigationOutcome = {
      ...outcome,
      candidate: null,
      retrievalConfidence: outcome.acceptanceVerdict === 'INSUFFICIENT_EVIDENCE'
        ? 0
        : outcome.retrievalConfidence,
    };
    pipeline.push(step(
      'report',
      'Generate investigation report',
      'complete',
      noSignatureOutcome.displayLabel,
    ));
    const recovery = identityRecovery ?? {
      enginesRun: 0,
      enginesRecovered: 0,
      signals: [],
      compositeScores: { ownershipConfidence: 0, trustScore: 0, identityConfidence: 0 },
      transformations: [],
      message: noSignatureOutcome.displayLabel,
    };
    logInvestigationDecision('build_no_match_report', noSignatureOutcome);

    const retrievalConfidence = noSignatureOutcome.retrievalConfidence;
    const trustScore = Math.max(enterprise?.fusion.trustScore ?? 0, recovery.compositeScores.trustScore);
    const identityConfidence = Math.max(enterprise?.fusion.identityConfidence ?? 0, recovery.compositeScores.identityConfidence);
    const investigatedAt = new Date().toISOString();

    const timelineEvents = this.buildTimeline({
      investigationId,
      investigatedAt,
      suspectFilename,
      suspectFileHash: currentFileHash,
      dnaRecordId: 'none',
      vaultId: 'none',
      dnaMeta: null,
      shareLinks: [],
      leakVerify,
      accessHistory: leakVerify.accessHistory ?? [],
      auditEvents: [],
      forensicVerdict: 'NO_SIGNATURE',
    });

    const noMatchMessage = customMessage ?? noSignatureOutcome.decisionReason;

    return {
      success: false,
      investigationId,
      investigatedAt,
      pipeline,
      summary: {
        ownershipConfidence: 0,
        retrievalConfidence,
        ownershipVerificationConfidence: 0,
        forensicVerdict: noSignatureOutcome.forensicVerdict,
        reportState: noSignatureOutcome.state,
        decisionReason: noMatchMessage,
        dnaMatchPercent: Math.round(retrievalConfidence || 0),
        certificateStatus: 'UNKNOWN',
        identityStatus: 'NOT_FOUND',
        tamperSeverity: 'UNKNOWN',
        riskLevel: 'UNKNOWN',
        trustScore: Math.min(trustScore, retrievalConfidence || 0),
        identityConfidence: Math.min(identityConfidence, retrievalConfidence || 0),
        acceptanceVerdict: noSignatureOutcome.acceptanceVerdict,
        acceptancePolicyVersion: noSignatureOutcome.acceptancePolicyVersion,
        acceptanceConfidence: noSignatureOutcome.acceptanceConfidence,
      },
      message: noMatchMessage,
      owner: {
        ownerName: null,
        ownerPinitId: null,
        vaultId: undefined,
        dnaRecordId: undefined,
        certificateId: null,
        originalFilename: undefined,
      },
      candidateRanking: enterprise?.candidates?.length
        ? enterprise.candidates.map((c, i) => ({ ...c, selected: false, rank: c.rank ?? i + 1 }))
        : undefined,
      recipientAttribution: this.buildRecipientSection(leakVerify),
      layerAnalysis: [],
      tamperAnalysis: buildTamperAnalysis({ comparison: null, leakVerify, fragmentReuse: fragmentReuseFindings }),
      fragmentReuseAnalysis: buildFragmentReuseSection(fragmentReuseFindings),
      timeline: timelineEvents,
      accessIntelligence: leakVerify.accessHistory ?? [],
      leakIntelligence: { hasPublicLeak: false, entries: [], message: 'No public leak detected.' },
      identityProof: {
        digitalSignatureValid: false,
        identityVerification: 'NOT_FOUND',
        watermark: resolveWatermarkProof(leakVerify, {}),
      },
      leakVerify: {
        found: leakVerify.found,
        message: leakVerify.message,
        accessHistory: leakVerify.accessHistory,
      },
      identityRecovery: recovery,
      currentFileHash,
    };
  }

  private buildRecipientSection(
    leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>>,
    accessHistory: LeakedFileAccessEntry[] = [],
  ) {
    const history = accessHistory.length ? accessHistory : (leakVerify.accessHistory ?? []);
    const fromShare = !!(leakVerify.shareLink || leakVerify.recipient)
      || history.some((a) => a.action && !a.action.startsWith('TEP_') && !a.action.startsWith('PROTECTED_'));
    if (!fromShare) {
      return { fromShare: false, message: 'Original Owner Only — no share recipient attribution.' };
    }
    const dl = history.find((a) => a.action?.toLowerCase().includes('download'));
    const view = history.find((a) => a.action?.toLowerCase().includes('view'));
    return {
      fromShare: true,
      recipientName: leakVerify.recipient?.label ?? leakVerify.shareLink?.recipientLabel,
      recipientPinitId: leakVerify.recipient?.recipientCode,
      shareId: leakVerify.shareLink?.token,
      viewTime: view?.timestamp,
      downloadTime: dl?.timestamp,
      screenshotDetected: leakVerify.leakVector === 'SCREENSHOT',
      screenRecordingDetected: leakVerify.leakVector === 'RECORDING',
      lastDevice: history[0]?.device,
      message: 'File traced to a shared copy recipient.',
    };
  }

  private buildTimeline(input: TimelineBuildInput): Array<{ stage: string; timestamp?: string; detail?: string }> {
    const events: Array<{ stage: string; timestamp?: string; detail?: string; sortKey: number }> = [];

    const add = (stage: string, timestamp: string | undefined, detail: string | undefined, sortKey?: number) => {
      const key = sortKey ?? (timestamp ? new Date(timestamp).getTime() : Number.MAX_SAFE_INTEGER);
      events.push({ stage, timestamp, detail, sortKey: key });
    };

    if (input.dnaMeta?.createdAt) {
      add('DNA Generated', input.dnaMeta.createdAt.toISOString(), input.dnaMeta.filename);
    } else if (input.leakVerify.identity?.dnaCreatedAt) {
      add('DNA Generated', input.leakVerify.identity.dnaCreatedAt, input.leakVerify.identity.originalFilename ?? undefined);
    }

    if (input.vaultId && input.vaultId !== 'none') {
      add('Stored in Vault', input.dnaMeta?.createdAt?.toISOString(), `Vault ${input.vaultId.slice(0, 8)}… · DNA ${input.dnaRecordId.slice(0, 8)}…`);
    }

    for (const ae of input.auditEvents) {
      const label = auditEventLabel(ae.eventType);
      if (label) {
        add(label, ae.createdAt.toISOString(), ae.filename ?? ae.device ?? ae.eventType);
      }
    }

    for (const link of input.shareLinks) {
      add('Share Link Created', link.createdAt.toISOString(), link.filename ?? `Share ${link.id.slice(0, 8)}…`);
      for (const log of link.accessLogs) {
        add(
          accessActionToStage(log.action),
          log.createdAt.toISOString(),
          ([log.device, log.city, log.country].filter(Boolean).join(' · ') || log.ipAddress) ?? undefined,
        );
      }
    }

    const seenAccess = new Set<string>();
    for (const a of input.accessHistory) {
      const key = `${a.timestamp}|${a.action}`;
      if (seenAccess.has(key)) continue;
      seenAccess.add(key);
      add(
        accessActionToStage(a.action),
        a.timestamp,
        [a.device, a.browser, a.city, a.country].filter(Boolean).join(' · ') || a.ipAddress,
      );
    }

    if (input.leakVerify.leakVector === 'SCREENSHOT') {
      add('Screenshot Leak Detected', undefined, input.leakVerify.detectionMethod ?? 'Leak vector analysis');
    }
    if (input.leakVerify.leakVector === 'RECORDING') {
      add('Screen Recording Leak Detected', undefined, input.leakVerify.detectionMethod ?? 'Leak vector analysis');
    }
    if (input.leakVerify.tampered) {
      add('Tampering Detected', undefined, input.leakVerify.detectionMethod);
    }

    for (const entry of input.leakIntel?.entries ?? []) {
      add(
        `Public Leak — ${entry.platform}`,
        entry.firstSeen ?? entry.lastSeen,
        entry.url,
      );
    }

    const verdictLabel = input.forensicVerdict
      ? FORENSIC_VERDICT_LABELS[input.forensicVerdict as ForensicVerdict] ?? input.forensicVerdict
      : undefined;
    const investigationDetail = [
      `Suspect file: ${input.suspectFilename}`,
      input.dnaMatchPercent != null ? `DNA match ${input.dnaMatchPercent}%` : null,
      verdictLabel,
      input.suspectFileHash ? `SHA-256 ${input.suspectFileHash.slice(0, 16)}…` : null,
      `Investigation ${input.investigationId.slice(0, 8)}…`,
    ].filter(Boolean).join(' · ');

    add('Forensic Investigation (this session)', input.investigatedAt, investigationDetail, new Date(input.investigatedAt).getTime());

    events.sort((a, b) => a.sortKey - b.sortKey);

    return events.map(({ stage, timestamp, detail }) => ({ stage, timestamp, detail }));
  }

  private async resolveTepForInvestigation(input: {
    vaultId?: string;
    dnaRecordId?: string;
    ownerUserId: string;
    probe?: { buffer: Buffer; mimeType: string; originalName: string; sizeBytes: number };
    accessIntelligence?: LeakedFileAccessEntry[];
    evidenceTimeline?: UnifiedInvestigationReport['evidenceTimeline'];
  }): Promise<{ tepCode?: string; protectedDownloadDate?: string }> {
    if (input.probe?.buffer?.length) {
      try {
        const extracted = await tepService.extractFromFile(
          input.probe.buffer,
          input.probe.mimeType,
          input.probe.originalName,
        );
        if (extracted.tepCode) {
          const manifest = await prisma.trackedExportPackage.findUnique({
            where: { tepCode: extracted.tepCode },
            select: { createdAt: true },
          });
          return {
            tepCode: extracted.tepCode,
            protectedDownloadDate: manifest?.createdAt.toISOString(),
          };
        }
      } catch (err) {
        logger.debug('[PartialReport] TEP extract from probe failed', { error: String(err) });
      }
    }

    const fromTimeline = input.evidenceTimeline?.find((e) => e.tepCode)?.tepCode;
    if (fromTimeline) {
      const manifest = await prisma.trackedExportPackage.findUnique({
        where: { tepCode: fromTimeline },
        select: { createdAt: true },
      });
      return {
        tepCode: fromTimeline,
        protectedDownloadDate: manifest?.createdAt.toISOString(),
      };
    }

    const fromAccess = input.accessIntelligence?.find((a) => a.tepCode);
    if (fromAccess?.tepCode) {
      return {
        tepCode: fromAccess.tepCode,
        protectedDownloadDate: fromAccess.timestamp,
      };
    }

    if (input.vaultId || input.dnaRecordId) {
      const latest = await prisma.trackedExportPackage.findFirst({
        where: {
          ownerUserId: input.ownerUserId,
          ...(input.vaultId ? { vaultId: input.vaultId } : {}),
          ...(input.dnaRecordId ? { dnaRecordId: input.dnaRecordId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { tepCode: true, createdAt: true },
      });
      if (latest?.tepCode) {
        return {
          tepCode: latest.tepCode,
          protectedDownloadDate: latest.createdAt.toISOString(),
        };
      }
    }

    return {};
  }

  private async loadAccessIntelligence(
    dnaRecordId: string,
    ownerUserId: string,
    fromLeakVerify: LeakedFileAccessEntry[],
  ): Promise<LeakedFileAccessEntry[]> {
    const merged = new Map<string, LeakedFileAccessEntry>();

    const add = (entry: LeakedFileAccessEntry) => {
      const key = `${entry.timestamp}|${entry.action}|${entry.ipAddress ?? ''}`;
      if (!merged.has(key)) merged.set(key, entry);
    };

    for (const e of fromLeakVerify) add(e);

    const links = await prisma.shareLink.findMany({
      where: { dnaRecordId, ownerUserId },
      include: {
        accessLogs: { orderBy: { createdAt: 'desc' }, take: 40 },
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const link of links) {
      for (const log of link.accessLogs) {
        add({
          timestamp: log.createdAt.toISOString(),
          action: log.action,
          ipAddress: log.ipAddress ?? undefined,
          country: log.country ?? undefined,
          city: log.city ?? undefined,
          region: log.region ?? undefined,
          device: log.device ?? log.userAgent ?? undefined,
          browser: log.browser ?? undefined,
          os: log.os ?? undefined,
          riskLevel: log.riskLevel ?? undefined,
          locationShared: log.locationShared,
        });
      }
    }

    const tepExports = await prisma.trackedExportPackage.findMany({
      where: { dnaRecordId, ownerUserId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    for (const tep of tepExports) {
      add({
        timestamp: tep.createdAt.toISOString(),
        action: 'TEP_EXPORT',
        tepCode: tep.tepCode,
        ipAddress: tep.ipAddress ?? undefined,
        country: tep.geoCountry ?? undefined,
        city: tep.geoCity ?? undefined,
        device: tep.deviceContext ?? undefined,
      });
    }

    return [...merged.values()].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  private async buildLeakIntelligence(dnaRecordId: string, ownerUserId: string) {
    const empty = {
      hasPublicLeak: false,
      entries: [] as Array<{ platform: string; url: string; firstSeen?: string; lastSeen?: string; status: string }>,
      leakChain: [] as Array<{ platform: string; date?: string; status: string }>,
      currentStatus: 'No public leak recorded',
      message: 'No public leak detected.',
    };

    if (investigationPerformanceConfig.skipCrawlerOnInvestigation) {
      return empty;
    }

    const platformFromUrl = (url: string): string => {
      const u = url.toLowerCase();
      if (u.includes('t.me') || u.includes('telegram')) return 'Telegram';
      if (u.includes('reddit')) return 'Reddit';
      if (u.includes('instagram')) return 'Instagram';
      if (u.includes('pinterest')) return 'Pinterest';
      if (u.includes('facebook') || u.includes('fb.com')) return 'Facebook';
      if (u.includes('twitter') || u.includes('x.com')) return 'X';
      if (u.includes('whatsapp')) return 'WhatsApp';
      if (u.includes('youtube')) return 'YouTube';
      return 'Web';
    };

    try {
      const monitors = await withTimeoutSoft(
        () => prisma.monitorRecord.findMany({
          where: { ownerUserId, dnaRecordId },
          take: 5,
          include: {
            crawlResults: {
              where: { matchType: { not: 'NONE' } },
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        }),
        investigationPerformanceConfig.orchestratorEnrichmentTimeoutMs,
        'investigation_crawler',
      );
      if (!monitors) {
        return { ...empty, message: 'Crawler enrichment timed out.' };
      }
      const related = monitors;
      const entries = related.flatMap((m) =>
        (m.crawlResults ?? []).map((cr) => ({
          platform: platformFromUrl(cr.url),
          url: cr.url,
          firstSeen: cr.createdAt?.toISOString?.() ?? String(cr.createdAt),
          lastSeen: cr.createdAt?.toISOString?.() ?? String(cr.createdAt),
          status: cr.matchType ?? 'DETECTED',
          source: 'crawler' as const,
        })),
      );

      const leakChain = entries
        .map((e) => ({
          platform: e.platform,
          date: e.firstSeen?.slice(0, 10),
          status: e.status,
        }))
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

      return {
        hasPublicLeak: entries.length > 0,
        entries,
        leakChain,
        currentStatus: entries.length ? 'Public' : 'No public leak recorded',
        message: entries.length
          ? `${entries.length} crawler match(es) — chronological leak chain available`
          : 'No public leak detected. Crawler will populate when monitoring is active.',
      };
    } catch {
      return empty;
    }
  }
}

export const unifiedInvestigationOrchestrator = new UnifiedInvestigationOrchestrator();
