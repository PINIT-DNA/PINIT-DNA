/**
 * Unified Forensic Investigation Center — orchestrates existing services only.
 */
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { leakedFileVerifyService } from './leaked-file-verify.service';
import { type VaultMatchResult } from './vault-auto-match.service';
import { certificateService } from '../certificates/certificate.service';
import { shareLinkService } from '../share/share-link.service';
import { isPhase2Active } from '../../config/dna-phase2';
import { resolveWatermarkProof } from './watermark-status.service';
import { enterpriseRecoveryPipeline, type EnterpriseRecoveryResult } from './enterprise-recovery-pipeline.service';
import { FORENSIC_VERDICT_LABELS, type ForensicVerdict } from './confidence-fusion-engine.service';
import {
  deriveInvestigationOutcome,
  downgradeToPossibleAfterWeakDna,
  forensicVerdictForSummary,
  insufficientEvidenceOutcome,
  logInvestigationDecision,
  notPinitOutcome,
  REPORT_STATE_LABELS,
  shouldRetainRetrievalCandidateAsPossible,
  type InvestigationOutcome,
} from './investigation-decision-resolver.service';
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
import { createStageTimer } from '../../lib/stage-timer';
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
} from '../../types/unified-investigation.types';
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
  emptyTamperAnalysis,
} from './tamper-analysis.service';

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
  if (certStatus === 'NOT_ISSUED' || certStatus === 'UNKNOWN' || !enterprise.certificateId) {
    reasons.push('Certificate unavailable');
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

    // Holder object so TS does not narrow away mutations from the emit closure.
    const liveState: { snapshot: InvestigationLiveSnapshot | null } = { snapshot: null };
    const emit = (event: InvestigationProgressEvent) => {
      if (event.snapshot?.vaultId) liveState.snapshot = event.snapshot;
      else if (event.partial?.vaultId) {
        const prev = liveState.snapshot;
        liveState.snapshot = {
          phase: prev?.phase ?? 1,
          signatureFound: true,
          vaultId: event.partial.vaultId,
          ownerPinitId: event.partial.ownerPinitId ?? prev?.ownerPinitId,
          ownerName: event.partial.ownerName ?? prev?.ownerName,
          originalFilename: event.partial.originalFilename ?? prev?.originalFilename,
          confidence: event.partial.ownershipConfidence ?? prev?.confidence,
          patchVotes: event.partial.patchVotes ?? prev?.patchVotes,
          orbScore: event.partial.orbScore ?? prev?.orbScore,
        };
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

    try {
    import('../platform-events/extended-events').then(({ emitInvestigationStarted }) => {
      emitInvestigationStarted({
        ownerUserId,
        investigationId,
        filename: originalName,
      });
    }).catch(() => {});

    orchestratorTimer.start('enterprise_recovery');
    const recoveryStage = await executeStage(
      'enterprise_recovery',
      async () => {
        const [ent, leak] = await Promise.all([
          enterpriseRecoveryPipeline.run(
            buffer, mimeType, originalName, sizeBytes, ownerUserId,
            {
              ...INVESTIGATION_RECOVERY_OPTS,
              onProgress: emit,
              stageTimer: orchestratorTimer,
            },
          ),
          leakedFileVerifyService.verify(buffer, mimeType, originalName, { lightweight: true }),
        ]);
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
      const timeoutError = recoveryStage.error ?? 'Enterprise recovery failed';
      const liveSnapshot = liveState.snapshot;
      // If SSE already showed a vault, never collapse to INSUFFICIENT_EVIDENCE —
      // user already saw the correct candidate (WhatsApp/scanner often times out mid deep-DNA).
      if (liveSnapshot?.vaultId) {
        logger.warn('Enterprise recovery timed out — retaining live vault match', {
          vaultId: liveSnapshot.vaultId,
          confidence: liveSnapshot.confidence,
          error: timeoutError,
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

    const { enterprise, leakVerify } = recoveryStage.data;

    pipeline.push(step(
      'identity',
      'Extract embedded identity',
      leakVerify.found ? 'complete' : 'warning',
      leakVerify.detectionMethod ?? leakVerify.message,
    ));

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

    let match: VaultMatchResult | null = reportOutcome.candidate;
    const authAsset = enterprise.authoritativeAsset;

    if (match && authAsset) {
      assertVaultScope(authAsset.vaultId, match.vaultId, 'orchestrator:report_candidate');
      assertDnaScope(authAsset.dnaRecordId, match.dnaRecordId, 'orchestrator:report_candidate');
    }

    const retrievalConf = reportOutcome.retrievalConfidence;

    if (reportOutcome.state === 'POSSIBLE' && match) {
      pipeline.push(step(
        'probable_match',
        'Probable vault match (visual DNA)',
        'warning',
        `${reportOutcome.displayLabel} — retrieval ${retrievalConf}% · vault ${match.vaultId.slice(0, 8)}…`,
      ));
    }

    const identityRecovery = buildIdentityRecoveryFromEnterprise(enterprise, reportOutcome);
    pipeline.push(step(
      'recovery_engines',
      'Multi-layer identity recovery',
      identityRecovery.enginesRecovered > 0 ? 'complete' : 'warning',
      identityRecovery.message,
    ));

    pipeline.push(step(
      'vault_search',
      'Search vault DNA records',
      match ? 'complete' : 'failed',
      match ? `Match tier ${match.tier}: ${match.method}` : 'No vault match in your account',
    ));

    if (!match || reportOutcome.state === 'NO_SIGNATURE') {
      const liveSnapshot = liveState.snapshot;
      if (liveSnapshot?.vaultId) {
        logger.warn('Final NO_SIGNATURE but live snapshot had vault — retaining owner as possible match', {
          vaultId: liveSnapshot.vaultId,
          confidence: liveSnapshot.confidence,
          decision: reportOutcome.decisionReason,
        });
        return this.buildPartialFromLiveSnapshot({
          investigationId,
          pipeline,
          progressTimeline,
          currentFileHash,
          originalName,
          ownerUserId,
          snapshot: liveSnapshot,
          error: reportOutcome.decisionReason || 'DNA verification insufficient for verified verdict',
          enterprise,
        });
      }
      logInvestigationDecision('no_match_report', { ...reportOutcome, candidate: null, state: 'NO_SIGNATURE' });
      const noMatch = await this.buildNoMatchReport(
        investigationId, pipeline, leakVerify, ownerUserId, identityRecovery,
        currentFileHash, originalName, reportOutcome, enterprise,
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

    if (rankedCandidates.length) {
      rankedCandidates = rankedCandidates.map((c) => ({
        ...c,
        selected: c.vaultId === match!.vaultId,
      }));
    }

    pipeline.push(step('vault_locate', 'Locate original vault file', 'complete', match.vaultId));

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

    let certStatus = 'NOT_ISSUED';
    if (resolvedCert) {
      const v = await certificateService.verify(resolvedCert.certificateId);
      certStatus = v.valid ? 'VALID' : v.status;
      pipeline.push(step('certificate', 'Verify certificate', v.valid ? 'complete' : 'warning', v.detail));
    } else {
      pipeline.push(step('certificate', 'Verify certificate', 'warning', 'No active certificate'));
    }
    const cert = resolvedCert ? { certificateId: resolvedCert.certificateId } : null;

    // 6. Authoritative 15-layer DNA comparison — always runs against authoritativeAsset
    let comparison: DnaComparisonResult | null = null;
    const probeInput = { buffer, mimeType, originalName, sizeBytes };

    try {
      if (!authAsset) {
        throw new Error('No authoritative asset — cannot run 15-layer DNA comparison');
      }

      assertVaultScope(authAsset.vaultId, match.vaultId, 'orchestrator:authoritative_dna_compare');
      assertDnaScope(authAsset.dnaRecordId, match.dnaRecordId, 'orchestrator:authoritative_dna_compare');

      comparison = await withTimeoutSoft(
        () => compareProbeToAuthoritativeAsset(authAsset, probeInput, ownerUserId),
        investigationPerformanceConfig.orchestratorCompareTimeoutMs,
        'authoritative_dna_compare',
      ) ?? null;

      if (!comparison && authAsset.deepCompare?.layerComparisons?.length) {
        comparison = comparisonFromDeepCompareResult(authAsset.deepCompare, authAsset, probeInput);
        pipeline.push(step(
          'dna_compare',
          '15-layer DNA comparison',
          'warning',
          `${comparison.overallConfidenceScore}% — cached enterprise layers (live compare timed out)`,
        ));
      } else if (!comparison && enterprise.bestDeepCompare?.layerComparisons?.length) {
        comparison = comparisonFromDeepCompareResult(enterprise.bestDeepCompare, authAsset, probeInput);
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

      if (comparison) {
        const cmpScore = comparison.overallConfidenceScore;
        const cmpClass = comparison.classification;
        const isCameraScan = isCameraScanFileName(originalName);
        const videoProbe = isVideoProbe;

        if (!isAcceptedAfterDnaCompare(
          match,
          cmpScore,
          cmpClass,
          isCameraScan,
          retrievalConf,
          { isVideoProbe: videoProbe },
        )) {
          if (shouldRetainRetrievalCandidateAsPossible(
            enterprise, match, cmpScore, retrievalConf,
            { isVideoProbe: videoProbe },
          )) {
            reportOutcome = downgradeToPossibleAfterWeakDna(
              match,
              reportOutcome,
              cmpScore,
              cmpClass,
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
        } else {
          pipeline.push(step('match_validation', 'Validate vault match', 'complete', explainMatchBasis(match)));
        }
      }
    } catch (e) {
      logger.error('Unified investigation authoritative DNA compare failed', { error: String(e) });
      pipeline.push(step('dna_compare', '15-layer DNA comparison', 'failed', String(e)));
    }

    const resolvedDnaScore = comparison?.overallConfidenceScore;
    if (resolvedDnaScore != null
      && resolvedDnaScore < 50
      && reportOutcome.state === 'VERIFIED'
      && shouldRetainRetrievalCandidateAsPossible(
        enterprise, match, resolvedDnaScore, retrievalConf, { isVideoProbe },
      )) {
      reportOutcome = downgradeToPossibleAfterWeakDna(
        match,
        reportOutcome,
        resolvedDnaScore,
        comparison?.classification ?? 'SIMILAR',
      );
      logInvestigationDecision('verified_downgraded_to_possible', reportOutcome, { dnaScore: resolvedDnaScore });
    }

    // Tamper localization — compare probe vs vault original for visual overlay
    let forensicScanWithRef = enterprise.auditContext?.forensicScan ?? null;
    if (mimeType.startsWith('image/') && match?.vaultId) {
      try {
        const vaultFile = await withTimeoutSoft(
          () => vaultService.retrieve(match.vaultId, ownerUserId),
          investigationPerformanceConfig.vaultRetrieveTimeoutMs,
          'vault_retrieve_tamper',
        );
        if (vaultFile?.originalBuffer) {
          const rescan = await withTimeoutSoft(
            () => forensicScannerService.scanProbe(buffer, mimeType, vaultFile.originalBuffer),
            30_000,
            'forensic_tamper_localize',
          );
          if (rescan?.available) forensicScanWithRef = rescan;
        }
      } catch {
        /* non-fatal */
      }
    }

    // 7. Tamper analysis — fault-isolated; never throws
    const tamperStage = executeStageSync(
      'tamper_analysis',
      () => buildTamperAnalysis({ comparison, leakVerify }),
      { onComplete: stageOnComplete('tamper_analysis', 'Tamper Analysis') },
    );
    const tamperAnalysis = tamperStage.data ?? emptyTamperAnalysis(tamperStage.error ?? 'Tamper analysis failed');
    pipeline.push(step(
      'tamper',
      'Tamper analysis',
      tamperStage.success ? 'complete' : 'warning',
      tamperAnalysis.primaryVector,
    ));

    const enrichmentMs = investigationPerformanceConfig.orchestratorEnrichmentTimeoutMs;
    const enrichment = await executeStagesParallel(
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
    );

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

    const dnaPct = comparison?.overallConfidenceScore ?? 0;

    const identityFromVault = owner?.shortId ?? null;
    const retrievalConfidence = reportOutcome.retrievalConfidence;
    const ownershipVerification = enterprise.fusion.ownershipVerificationConfidence;
    const forensicVerdict = forensicVerdictForSummary(reportOutcome);
    const forensicReasons = buildForensicReasons(enterprise, originalName, certStatus);

    const identityStatus = mapIdentityStatus(
      enterprise, leakVerify, identityFromVault, retrievalConfidence,
    );

    const ownershipConf = ownershipVerification;

    const trustScore = Math.max(enterprise.fusion.trustScore, identityRecovery.compositeScores.trustScore);
    const identityConfidence = Math.max(enterprise.fusion.identityConfidence, identityRecovery.compositeScores.identityConfidence);

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

    const reportMessage = `${reportOutcome.displayLabel}. ${reportOutcome.decisionReason}${forensicReasons.length ? ` Reason: ${forensicReasons.join('; ')}.` : ''}`;

    logInvestigationDecision('final_report', reportOutcome, { dnaMatchPercent: dnaPct, certificateStatus: certStatus });

    const summary = {
      ownershipConfidence: ownershipConf,
      retrievalConfidence,
      ownershipVerificationConfidence: ownershipVerification,
      forensicVerdict,
      reportState: reportOutcome.state,
      decisionReason: reportOutcome.decisionReason,
      forensicReasons: forensicReasons.length ? forensicReasons : undefined,
      dnaMatchPercent: dnaPct,
      certificateStatus: certStatus,
      identityStatus,
      tamperSeverity: tamperAnalysis.primaryVector,
      riskLevel: riskFromScores(dnaPct, tamperAnalysis.overallTamperScore, true),
      trustScore,
      identityConfidence,
      acceptanceVerdict: reportOutcome.acceptanceVerdict,
      acceptancePolicyVersion: reportOutcome.acceptancePolicyVersion,
      acceptanceConfidence: reportOutcome.acceptanceConfidence,
    };

    const identityRecoveryReport = this.buildIdentityRecoveryReport({
      match,
      owner,
      dnaRec,
      cert,
      leakVerify,
      currentFileHash,
      ownershipConf,
      accessIntelligence,
      evidenceConf,
      originalFilename,
    });

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

    const report: UnifiedInvestigationReport = {
      success: true,
      investigationId,
      investigatedAt: new Date().toISOString(),
      pipeline,
      summary,
      message: reportMessage,
      owner: {
        ownerName: owner?.fullName ?? owner?.shortId ?? authAsset?.ownerPinitId ?? null,
        ownerPinitId: authAsset?.ownerPinitId ?? owner?.shortId ?? null,
        vaultId: match.vaultId,
        dnaRecordId: match.dnaRecordId,
        certificateId: cert?.certificateId ?? authAsset?.certificateId ?? null,
        originalFilename,
        createdAt: dnaRec?.createdAt?.toISOString(),
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
        vaultId: match.vaultId,
        dnaRecordId: match.dnaRecordId,
        certificateId: cert?.certificateId ?? authAsset?.certificateId ?? undefined,
        ownerPinitId: authAsset?.ownerPinitId ?? owner?.shortId ?? undefined,
        digitalSignatureValid: !!leakVerify.valid,
        watermark: resolveWatermarkProof(leakVerify, {
          vaultId: match.vaultId,
          ownerPinitId: owner?.shortId ?? undefined,
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
      matchMethod: match.method,
      identityRecovery,
      candidateRanking: rankedCandidates.length ? rankedCandidates : undefined,
      identityRecoveryReport,
      forensicEvidence,
      currentFileHash,
      stageTimings,
      progressTimeline,
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
  }): IdentityRecoveryReportSection {
    const { match, owner, dnaRec, cert, leakVerify, currentFileHash, ownershipConf, accessIntelligence, evidenceConf, originalFilename } = params;
    const protectedDl = accessIntelligence.find((a) =>
      a.action?.includes('PROTECTED') || a.action?.includes('TEP_EXPORT'),
    );
    const device = accessIntelligence.find((a) => a.device)?.device;

    return {
      recovered: ownershipConf >= 50,
      originalOwner: owner?.fullName ?? owner?.shortId ?? null,
      ownerPinitId: owner?.shortId ?? null,
      vaultId: match.vaultId,
      dnaRecordId: match.dnaRecordId,
      certificateId: cert?.certificateId ?? null,
      originalFilename: originalFilename ?? dnaRec?.imageFilename ?? undefined,
      createdAt: dnaRec?.createdAt?.toISOString(),
      protectedDownloadDate: protectedDl?.timestamp,
      originalDevice: device,
      registrationTimestamp: leakVerify.identity?.dnaCreatedAt ?? dnaRec?.createdAt?.toISOString(),
      originalHash: dnaRec?.sha256Hash ?? undefined,
      currentHash: currentFileHash,
      evidenceConfidence: evidenceConf?.trustScore ?? ownershipConf,
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
  }): Promise<UnifiedInvestigationReport> {
    const { snapshot } = params;
    const vaultId = snapshot.vaultId!;
    // Never invent floors (was max(..., 30) / max(conf, 40)) — that turned weak
    // lookalike leads into "Original Found — Derivative Detected" (false positives).
    const liveConf = Math.max(0, snapshot.confidence ?? 0);
    const realDna = snapshot.dnaMatchPercent;
    const hasRealDna = typeof realDna === 'number' && realDna >= 40;
    const fusionOwnership = params.enterprise?.fusion.ownershipVerificationConfidence ?? 0;
    const fusionIdentity = params.enterprise?.fusion.identityConfidence ?? 0;
    const fusionTrust = params.enterprise?.fusion.trustScore ?? 0;

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

    const dnaRecordId = vaultRow?.dnaRecordId ?? snapshot.dnaRecordId ?? undefined;
    const ownerName = vaultRow?.dnaRecord?.ownerUser?.fullName
      ?? snapshot.ownerName
      ?? null;
    const ownerPinitId = vaultRow?.dnaRecord?.ownerUser?.shortId
      ?? snapshot.ownerPinitId
      ?? null;
    const originalFilename = vaultRow?.originalFileName
      ?? snapshot.originalFilename
      ?? undefined;

    const hasOwnerLead = !!(ownerName || ownerPinitId);
    /** Live UI already showed vault + owner — keep in final report even if deep DNA incomplete */
    const retainOwnerLead = !!vaultId && hasOwnerLead && (hasRealDna || liveConf >= 20);
    const displayConf = hasRealDna
      ? Math.max(liveConf, realDna!, fusionOwnership, fusionIdentity)
      : retainOwnerLead
        ? Math.max(liveConf, fusionOwnership, fusionIdentity, fusionTrust)
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
        ? `Live DNA retained after timeout — vault ${vaultId.slice(0, 8)}…`
        : `Unconfirmed live lead ${vaultId.slice(0, 8)}… — DNA not completed`,
    ));
    params.pipeline.push(step(
      'report',
      'Generate investigation report',
      'warning',
      `Partial report — ${params.error}`,
    ));

    // Acceptance only verifies when phase-3 DNA actually completed.
    // Weak vector leads (~30%) must not become VERIFIED_DERIVATIVE.
    const decision = runAcceptanceEngine({
      analysisComplete: hasRealDna,
      hasCandidate: hasRealDna || retainOwnerLead,
      vaultId: hasRealDna || retainOwnerLead ? vaultId : undefined,
      dnaRecordId: hasRealDna || retainOwnerLead ? dnaRecordId : undefined,
      ownerUserId: params.ownerUserId,
      ownerPinitId: hasRealDna || retainOwnerLead ? (ownerPinitId ?? undefined) : undefined,
      dna: hasRealDna
        ? passChannel(realDna!, 'completed_deep_dna')
        : failChannel(liveConf, 'deep_dna_not_completed'),
      certificate: certificateId
        ? passChannel(50, certificateId)
        : skippedChannel('No certificate'),
      vault: hasRealDna || retainOwnerLead ? passChannel(100, vaultId) : failChannel(0, 'unconfirmed_live_lead'),
      owner: hasRealDna || retainOwnerLead ? passChannel(Math.max(liveConf, 30)) : failChannel(0, 'unconfirmed_live_lead'),
      timeline: hasRealDna || retainOwnerLead ? passChannel(40) : failChannel(0, 'incomplete'),
      visual: hasRealDna && liveConf >= 40
        ? passChannel(liveConf)
        : retainOwnerLead && liveConf >= 20
          ? passChannel(Math.max(liveConf, 40), 'live_retrieval_lead')
          : failChannel(liveConf, 'visual_unconfirmed'),
      watermark: failChannel(0),
      metadata: skippedChannel(),
      tamperDetected: hasRealDna,
      failureReason: hasRealDna ? undefined : params.error,
    });

    const conf = displayConf;

    const reportState: 'VERIFIED' | 'POSSIBLE' | 'NO_SIGNATURE' = hasRealDna
      ? mapAcceptanceToReportState(decision.verdict)
      : retainOwnerLead
        ? 'POSSIBLE'
        : mapAcceptanceToReportState(decision.verdict);

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

    if ((retainOwnerLead || hasRealDna) && dnaRecordId && vaultId) {
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
      && (retainOwnerLead || hasRealDna)
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

    const ownerBlock = retainOwnerLead || hasRealDna
      ? {
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

    const partialReviewNote = retainOwnerLead && !hasRealDna
      ? `deep DNA verification incomplete (${Math.round(liveConf)}% live retrieval confidence)`
      : params.error;

    const report: UnifiedInvestigationReport = {
      success: reportState !== 'NO_SIGNATURE',
      investigationId: params.investigationId,
      investigatedAt,
      pipeline: params.pipeline,
      summary: {
        ownershipConfidence: conf,
        retrievalConfidence: retainOwnerLead || hasRealDna ? conf : 0,
        ownershipVerificationConfidence: Math.max(conf, fusionOwnership),
        forensicVerdict: reportState === 'POSSIBLE' ? 'POSSIBLE_ASSET' : mapAcceptanceToForensicVerdict(decision.verdict),
        reportState,
        decisionReason: retainOwnerLead && !hasRealDna
          ? `Live vault match retained — owner identified at ${Math.round(liveConf)}% confidence; ${partialReviewNote}`
          : decision.decisionReason,
        dnaMatchPercent: hasRealDna ? realDna! : 0,
        certificateStatus: certificateId ? 'ACTIVE' : (retainOwnerLead ? 'NOT_ISSUED' : 'UNKNOWN'),
        identityStatus: retainOwnerLead || hasRealDna
          ? (ownerPinitId ? 'PARTIALLY_RECOVERED' : 'FOUND')
          : 'NOT_FOUND',
        tamperSeverity: hasRealDna ? 'UNKNOWN' : 'UNKNOWN',
        riskLevel: retainOwnerLead || hasRealDna ? 'MEDIUM' : 'UNKNOWN',
        trustScore: Math.max(conf, fusionTrust),
        identityConfidence: Math.max(conf, fusionIdentity),
        acceptanceVerdict: reportState === 'POSSIBLE' ? 'POSSIBLE_MATCH' : decision.verdict,
      },
      message: hasRealDna
        ? `Deep DNA completed before timeout (vault ${vaultId.slice(0, 8)}…) — ${decision.displayLabel}`
        : retainOwnerLead
          ? `Possible PINIT asset — owner ${ownerName ?? ownerPinitId} identified from live recovery at ${Math.round(liveConf)}% confidence; confirm with manual review`
          : `Investigation incomplete — live lead ${vaultId.slice(0, 8)}… was not DNA-verified (${params.error}). Not treated as an original match.`,
      owner: ownerBlock,
      recipientAttribution: {
        fromShare: false,
        message: 'Original Owner Only — no share recipient attribution.',
      },
      layerAnalysis: [],
      tamperAnalysis: emptyTamperAnalysis(params.error),
      timeline: timelineEvents,
      evidenceTimeline,
      provenanceSummary,
      accessIntelligence,
      leakIntelligence: leakIntel,
      identityProof: {
        vaultId: retainOwnerLead || hasRealDna ? vaultId : undefined,
        dnaRecordId: retainOwnerLead || hasRealDna ? dnaRecordId : undefined,
        certificateId: retainOwnerLead || hasRealDna ? certificateId : undefined,
        ownerPinitId: retainOwnerLead || hasRealDna ? (ownerPinitId ?? undefined) : undefined,
        digitalSignatureValid: false,
        identityVerification: retainOwnerLead || hasRealDna ? 'PARTIALLY_RECOVERED' : 'NOT_FOUND',
        watermark: {
          status: 'NOT_EMBEDDED',
          reason: hasRealDna
            ? 'DNA completed before timeout'
            : retainOwnerLead
              ? 'Live vault match — deep DNA verification incomplete'
              : 'Live vector lead only — not DNA-verified',
          confidence: conf,
        },
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
        recovered: hasRealDna || (retainOwnerLead && conf >= 50),
        originalOwner: retainOwnerLead || hasRealDna ? ownerName : null,
        ownerPinitId: retainOwnerLead || hasRealDna ? ownerPinitId : null,
        vaultId: retainOwnerLead || hasRealDna ? vaultId : undefined,
        dnaRecordId: retainOwnerLead || hasRealDna ? dnaRecordId : undefined,
        certificateId: retainOwnerLead || hasRealDna ? (certificateId ?? null) : null,
        originalFilename: retainOwnerLead || hasRealDna ? originalFilename : undefined,
        createdAt: vaultRow?.dnaRecord?.createdAt?.toISOString(),
        registrationTimestamp: vaultRow?.dnaRecord?.createdAt?.toISOString(),
        originalHash: vaultRow?.dnaRecord?.sha256Hash ?? undefined,
        currentHash: params.currentFileHash,
        evidenceConfidence: conf,
        message: hasRealDna
          ? 'Identity DNA-verified from live investigation snapshot before timeout'
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
    const leakVerify = params.leakVerify ?? {
      found: false,
      valid: false,
      tampered: false,
      message: params.error,
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
  ): Promise<UnifiedInvestigationReport> {
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
    const ownershipVerificationConfidence = enterprise?.fusion.ownershipVerificationConfidence ?? 0;
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
        ownershipConfidence: ownershipVerificationConfidence,
        retrievalConfidence,
        ownershipVerificationConfidence,
        forensicVerdict: noSignatureOutcome.forensicVerdict,
        reportState: noSignatureOutcome.state,
        decisionReason: noSignatureOutcome.decisionReason,
        dnaMatchPercent: 0,
        certificateStatus: 'UNKNOWN',
        identityStatus: 'NOT_FOUND',
        tamperSeverity: 'UNKNOWN',
        riskLevel: 'UNKNOWN',
        trustScore,
        identityConfidence,
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
        certificateId: undefined,
        originalFilename: undefined,
        createdAt: undefined,
      },
      recipientAttribution: this.buildRecipientSection(leakVerify),
      layerAnalysis: [],
      tamperAnalysis: buildTamperAnalysis({ comparison: null, leakVerify }),
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
      candidateRanking: undefined,
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
