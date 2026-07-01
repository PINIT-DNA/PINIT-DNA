/**
 * Unified Forensic Investigation Center — orchestrates existing services only.
 */
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { leakedFileVerifyService } from './leaked-file-verify.service';
import { type VaultMatchResult } from './vault-auto-match.service';
import { VaultService } from '../vault/vault.service';
import { DnaComparisonService } from '../verification/dna-comparison.service';
import { certificateService } from '../certificates/certificate.service';
import { shareLinkService } from '../share/share-link.service';
import { tamperClassifierService } from './tamper-classifier.service';
import { isPhase2Active } from '../../config/dna-phase2';
import { resolveWatermarkProof } from './watermark-status.service';
import { enterpriseRecoveryPipeline, type EnterpriseRecoveryResult } from './enterprise-recovery-pipeline.service';
import { FORENSIC_VERDICT_LABELS, type ForensicVerdict } from './confidence-fusion-engine.service';
import {
  deriveInvestigationOutcome,
  downgradeToPossibleAfterWeakDna,
  forensicVerdictForSummary,
  logInvestigationDecision,
  REPORT_STATE_LABELS,
  shouldRetainRetrievalCandidateAsPossible,
  type InvestigationOutcome,
} from './investigation-decision-resolver.service';
import { investigationPerformanceConfig } from '../../config/investigation-performance';
import { createStageTimer } from '../../lib/stage-timer';
import { withTimeoutSoft } from '../../lib/safe-runner';
import { isAcceptedAfterDnaCompare, isCameraScanFileName, explainMatchBasis } from './vault-match-validator.service';
import { evidenceConfidenceService } from './evidence-confidence.service';
import { auditService } from '../audit/audit.service';
import crypto from 'crypto';
import type {
  UnifiedInvestigationReport,
  InvestigationPipelineStep,
  InvestigationProgressEvent,
  TamperAnalysisSection,
  LeakedFileAccessEntry,
  RankedVaultCandidate,
  IdentityRecoveryReportSection,
  IdentityRecoverySection,
  LeakIntelligenceSection,
} from '../../types/unified-investigation.types';
const vaultService = new VaultService();
const comparisonService = new DnaComparisonService();

function step(
  id: string,
  label: string,
  status: InvestigationPipelineStep['status'],
  detail?: string,
): InvestigationPipelineStep {
  return { id, label, status, detail };
}

function layerStatus(pct: number): 'verified' | 'warning' | 'failed' {
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

    const emit = (event: InvestigationProgressEvent) => {
      progressTimeline.push(event);
      options?.onProgress?.(event);
    };

    for (const s of LIVE_TIMELINE_STEPS) {
      emit({ type: 'timeline', stepId: s.id, label: s.label, status: 'pending' });
    }

    const currentFileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    orchestratorTimer.start('enterprise_recovery');
    // Enterprise OIR + leak verify in parallel
    const [enterprise, leakVerify] = await Promise.all([
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
    orchestratorTimer.end('enterprise_recovery');

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
      logInvestigationDecision('no_match_report', { ...reportOutcome, candidate: null, state: 'NO_SIGNATURE' });
      return this.buildNoMatchReport(
        investigationId, pipeline, leakVerify, ownerUserId, identityRecovery,
        currentFileHash, originalName, reportOutcome, enterprise,
      );
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

    const enterpriseValidated = enterprise.identified && enterprise.match?.vaultId === match.vaultId;
    const alreadyDeepCompared = enterprise.bestDeepCompare?.vaultId === match.vaultId;
    const enterpriseDeepScore = enterprise.bestDeepCompare?.overallConfidenceScore ?? 0;
    const skipHeavyCompare = investigationPerformanceConfig.skipOrchestratorRecompare
      && (!!alreadyDeepCompared || match.tier === 1 || enterpriseValidated);

    const [resolvedCert, dnaPrefetch] = await Promise.all([
      certificateService.findActiveForAsset({
        dnaRecordId: match.dnaRecordId,
        vaultId: match.vaultId,
        ownerUserId,
        hintCertificateId: enterprise.certificateId,
      }),
      prisma.dnaRecord.findUnique({
        where: { id: match.dnaRecordId },
        select: { createdAt: true, imageFilename: true, sha256Hash: true },
      }),
    ]);

    let certStatus = 'NOT_ISSUED';
    if (resolvedCert) {
      const v = await certificateService.verify(resolvedCert.certificateId);
      certStatus = v.valid ? 'VALID' : v.status;
      pipeline.push(step('certificate', 'Verify certificate', v.valid ? 'complete' : 'warning', v.detail));
    } else {
      pipeline.push(step('certificate', 'Verify certificate', 'warning', 'No active certificate'));
    }
    const cert = resolvedCert ? { certificateId: resolvedCert.certificateId } : null;

    // 6. DNA comparison — reuse enterprise deep compare (never re-run when already done)
    let comparison = null;
    let isIdentical = dnaPrefetch?.sha256Hash === currentFileHash;

    try {
      if (skipHeavyCompare || isIdentical) {
        const score = isIdentical ? 100 : enterpriseDeepScore || retrievalConf;
        pipeline.push(step(
          'dna_compare',
          '15-layer DNA comparison',
          'complete',
          isIdentical
            ? 'Byte-identical to vault original (100%)'
            : `${score}% — enterprise retrieval engine (re-compare skipped)`,
        ));
        const acceptRetrieval = retrievalConf >= 40
          || enterpriseValidated
          || isIdentical
          || isAcceptedAfterDnaCompare(
            match,
            enterpriseDeepScore || score,
            enterprise.bestDeepCompare?.classification ?? 'VARIANT',
            isCameraScanFileName(originalName),
            retrievalConf,
          );
        if (acceptRetrieval) {
          pipeline.push(step('match_validation', 'Validate vault match', 'complete', explainMatchBasis(match)));
        } else if (shouldRetainRetrievalCandidateAsPossible(
          enterprise, match, enterpriseDeepScore || score, retrievalConf,
        )) {
          reportOutcome = downgradeToPossibleAfterWeakDna(
            match,
            reportOutcome,
            enterpriseDeepScore || score,
            enterprise.bestDeepCompare?.classification ?? 'VARIANT',
          );
          pipeline.push(step(
            'match_validation',
            'Validate vault match',
            'warning',
            `Weak DNA ${enterpriseDeepScore || score}% — retained as possible match (${explainMatchBasis(match)})`,
          ));
          logInvestigationDecision('match_downgraded_to_possible', reportOutcome, { dnaScore: enterpriseDeepScore });
        } else {
          logger.warn('Unified investigation: match rejected after enterprise deep compare', {
            vaultId: match.vaultId,
            score: enterpriseDeepScore,
            retrievalConf,
          });
          pipeline.push(step(
            'match_validation',
            'Validate vault match',
            'failed',
            `Rejected — ${enterpriseDeepScore}% DNA score does not confirm vault pairing`,
          ));
          const rejectedOutcome: InvestigationOutcome = {
            state: 'NO_SIGNATURE',
            candidate: null,
            retrievalConfidence: retrievalConf,
            forensicVerdict: 'NO_SIGNATURE',
            displayLabel: REPORT_STATE_LABELS.NO_SIGNATURE,
            decisionReason: `DNA compare rejected candidate vault ${match.vaultId.slice(0, 8)}… — score ${enterpriseDeepScore}%`,
          };
          logInvestigationDecision('match_rejected', rejectedOutcome);
          emit({ type: 'timeline', stepId: 'final_report', label: 'Final Report', status: 'complete' });
          return this.buildNoMatchReport(
            investigationId,
            pipeline,
            leakVerify,
            ownerUserId,
            identityRecovery,
            currentFileHash,
            originalName,
            rejectedOutcome,
            enterprise,
            `Vault candidate rejected after 15-layer compare (${enterpriseDeepScore}%).`,
          );
        }
      } else {
      const original = await withTimeoutSoft(
        () => vaultService.retrieve(match.vaultId, ownerUserId),
        investigationPerformanceConfig.vaultRetrieveTimeoutMs,
        'orchestrator_vault_retrieve',
      );
      if (!original) {
        pipeline.push(step('dna_compare', '15-layer DNA comparison', 'warning', 'Vault retrieve timed out — using retrieval scores'));
        if (shouldRetainRetrievalCandidateAsPossible(enterprise, match, enterpriseDeepScore || retrievalConf, retrievalConf)) {
          reportOutcome = downgradeToPossibleAfterWeakDna(
            match, reportOutcome, enterpriseDeepScore || retrievalConf,
            enterprise.bestDeepCompare?.classification ?? 'VARIANT',
          );
        }
      } else {
      isIdentical = original.originalBuffer.equals(buffer);

      if (isIdentical || match.tier === 1) {
        pipeline.push(step(
          'dna_compare',
          '15-layer DNA comparison',
          'complete',
          isIdentical ? 'Byte-identical to vault original (100%)' : 'Exact vault match',
        ));
        pipeline.push(step('match_validation', 'Validate vault match', 'complete', explainMatchBasis(match)));
      } else {
      try {
        comparison = await withTimeoutSoft(
          () => comparisonService.compare(
            {
              filePath: '',
              originalName: original.originalFileName,
              declaredMimeType: original.originalMimeType,
              sizeBytes: original.originalSizeBytes,
              buffer: original.originalBuffer,
            },
            {
              filePath: '',
              originalName,
              declaredMimeType: mimeType,
              sizeBytes,
              buffer,
            },
            { vaultDnaRecordId: match.dnaRecordId },
          ),
          investigationPerformanceConfig.orchestratorCompareTimeoutMs,
          'orchestrator_dna_compare',
        );
        if (!comparison && alreadyDeepCompared) {
          pipeline.push(step(
            'dna_compare',
            '15-layer DNA comparison',
            'complete',
            `${enterpriseDeepScore}% — enterprise retrieval (orchestrator compare timed out)`,
          ));
        } else if (!comparison) {
          pipeline.push(step('dna_compare', '15-layer DNA comparison', 'warning', 'Layer compare timed out'));
        } else {
        pipeline.push(step(
          'dna_compare',
          '15-layer DNA comparison',
          'complete',
          `${comparison.overallConfidenceScore}% — ${comparison.classification}`,
        ));

        const isCameraScan = isCameraScanFileName(originalName);
        const cmpScore = comparison?.overallConfidenceScore ?? enterpriseDeepScore;
        const cmpClass = comparison?.classification ?? enterprise.bestDeepCompare?.classification ?? 'VARIANT';
        if (comparison && !enterpriseValidated && !isAcceptedAfterDnaCompare(
          match,
          cmpScore,
          cmpClass,
          isCameraScan,
          retrievalConf,
        )) {
          if (shouldRetainRetrievalCandidateAsPossible(
            enterprise, match, cmpScore, retrievalConf,
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
          logger.warn('Unified investigation: match rejected after DNA comparison', {
            vaultId: match.vaultId,
            score: cmpScore,
            classification: cmpClass,
          });
          pipeline.push(step(
            'match_validation',
            'Validate vault match',
            'failed',
            `Rejected — ${cmpScore}% DNA score does not confirm vault pairing`,
          ));
          const rejectedOutcome: InvestigationOutcome = {
            state: 'NO_SIGNATURE',
            candidate: null,
            retrievalConfidence: retrievalConf,
            forensicVerdict: 'NO_SIGNATURE',
            displayLabel: REPORT_STATE_LABELS.NO_SIGNATURE,
            decisionReason: `DNA compare rejected candidate vault ${match.vaultId.slice(0, 8)}… — ${cmpScore}% ${cmpClass}`,
          };
          logInvestigationDecision('match_rejected', rejectedOutcome);
          emit({ type: 'timeline', stepId: 'final_report', label: 'Final Report', status: 'complete' });
          return this.buildNoMatchReport(
            investigationId,
            pipeline,
            leakVerify,
            ownerUserId,
            identityRecovery,
            currentFileHash,
            originalName,
            rejectedOutcome,
            enterprise,
            `Vault candidate rejected after 15-layer compare (${cmpScore}% — ${cmpClass}). Scanned file does not match this vault record.`,
          );
          }
        } else {
        pipeline.push(step('match_validation', 'Validate vault match', 'complete', explainMatchBasis(match)));
        }
        }
      } catch (cmpErr) {
        logger.error('Unified investigation DNA compare failed', { error: String(cmpErr) });
        pipeline.push(step(
          'dna_compare',
          '15-layer DNA comparison',
          isIdentical ? 'complete' : 'warning',
          isIdentical
            ? 'Byte-identical to vault original'
            : match.visualSimilarity
              ? `Visual match ${Math.round((match.visualSimilarity ?? 0) * 100)}% — layer compare unavailable`
              : String(cmpErr),
        ));
      }
      }
      }
      }
    } catch (e) {
      pipeline.push(step('dna_compare', '15-layer DNA comparison', 'failed', String(e)));
    }

    const resolvedDnaScore = comparison?.overallConfidenceScore
      ?? enterprise.bestDeepCompare?.overallConfidenceScore
      ?? (isIdentical ? 100 : undefined);
    if (resolvedDnaScore != null
      && resolvedDnaScore < 50
      && reportOutcome.state === 'VERIFIED'
      && shouldRetainRetrievalCandidateAsPossible(enterprise, match, resolvedDnaScore, retrievalConf)) {
      reportOutcome = downgradeToPossibleAfterWeakDna(
        match,
        reportOutcome,
        resolvedDnaScore,
        comparison?.classification ?? enterprise.bestDeepCompare?.classification ?? 'VARIANT',
      );
      logInvestigationDecision('verified_downgraded_to_possible', reportOutcome, { dnaScore: resolvedDnaScore });
    }

    // 7. Tamper analysis
    const tamperAnalysis = this.buildTamperAnalysis(comparison, leakVerify);
    pipeline.push(step('tamper', 'Tamper analysis', 'complete', tamperAnalysis.primaryVector));

    const [accessIntelligence, vaultRow, owner, leakIntel] = await Promise.all([
      this.loadAccessIntelligence(match.dnaRecordId, ownerUserId, leakVerify.accessHistory ?? []),
      prisma.vaultRecord.findUnique({
        where: { id: match.vaultId },
        select: { originalFileName: true },
      }),
      prisma.user.findUnique({
        where: { id: match.ownerUserId },
        select: { fullName: true, shortId: true, email: true },
      }),
      this.buildLeakIntelligence(match.dnaRecordId, ownerUserId),
    ]);
    const dnaRec = dnaPrefetch;
    const originalFilename = dnaRec?.imageFilename ?? vaultRow?.originalFileName ?? leakVerify.identity?.originalFilename;

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
    const enrichmentMs = investigationPerformanceConfig.orchestratorEnrichmentTimeoutMs;
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
        dnaMatchPercent: comparison?.overallConfidenceScore
          ?? enterprise.bestDeepCompare?.overallConfidenceScore
          ?? (Number.parseInt(match.confidence, 10) || undefined),
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
        dnaMatchPercent: enterprise.bestDeepCompare?.overallConfidenceScore,
        forensicVerdict: forensicVerdictForSummary(reportOutcome),
      });
    }

    pipeline.push(step(
      'crawler',
      'Crawler detections',
      leakIntel.hasPublicLeak ? 'warning' : 'complete',
      leakIntel.message,
    ));

    // 14. Report
    pipeline.push(step('report', 'Generate investigation report', 'complete'));

    const dnaPct = comparison?.overallConfidenceScore
      ?? (isIdentical ? 100 : undefined)
      ?? enterprise.bestDeepCompare?.overallConfidenceScore
      ?? (match.tier === 1 ? 100 : undefined)
      ?? (match.visualSimilarity ? Math.round(match.visualSimilarity * 100) : undefined)
      ?? (Number.parseInt(match.confidence, 10) || undefined)
      ?? (leakVerify.confidence ?? 0);

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
      matchPercent: l.similarityPercent,
      status: layerStatus(l.similarityPercent),
      explanation: l.changeDescription,
    }));

    if (rankedCandidates.length && comparison) {
      const sel = rankedCandidates.find((c) => c.selected);
      if (sel) sel.dnaMatchPercent = dnaPct;
    }

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

    return {
      success: true,
      investigationId,
      investigatedAt: new Date().toISOString(),
      pipeline,
      summary,
      message: reportMessage,
      owner: {
        ownerName: owner?.fullName ?? null,
        ownerPinitId: owner?.shortId ?? null,
        vaultId: match.vaultId,
        dnaRecordId: match.dnaRecordId,
        certificateId: cert?.certificateId ?? null,
        originalFilename,
        createdAt: dnaRec?.createdAt?.toISOString(),
      },
      recipientAttribution: this.buildRecipientSection(leakVerify, accessIntelligence),
      dnaComparison: comparison,
      layerAnalysis,
      tamperAnalysis,
      timeline: timelineEvents,
      accessIntelligence,
      leakIntelligence: leakIntel,
      identityProof: {
        vaultId: match.vaultId,
        dnaRecordId: match.dnaRecordId,
        certificateId: cert?.certificateId ?? enterprise.certificateId ?? undefined,
        ownerPinitId: owner?.shortId ?? undefined,
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
      currentFileHash,
      stageTimings,
      progressTimeline,
    };
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
      originalOwner: owner?.fullName ?? null,
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
    pipeline.push(step('report', 'Generate investigation report', 'complete', REPORT_STATE_LABELS.NO_SIGNATURE));
    const recovery = identityRecovery ?? {
      enginesRun: 0,
      enginesRecovered: 0,
      signals: [],
      compositeScores: { ownershipConfidence: 0, trustScore: 0, identityConfidence: 0 },
      transformations: [],
      message: REPORT_STATE_LABELS.NO_SIGNATURE,
    };

    const noSignatureOutcome: InvestigationOutcome = {
      ...outcome,
      state: 'NO_SIGNATURE',
      candidate: null,
      forensicVerdict: 'NO_SIGNATURE',
      displayLabel: REPORT_STATE_LABELS.NO_SIGNATURE,
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
        forensicVerdict: 'NO_SIGNATURE',
        reportState: 'NO_SIGNATURE',
        decisionReason: noSignatureOutcome.decisionReason,
        dnaMatchPercent: 0,
        certificateStatus: 'UNKNOWN',
        identityStatus: 'NOT_FOUND',
        tamperSeverity: 'UNKNOWN',
        riskLevel: 'UNKNOWN',
        trustScore,
        identityConfidence,
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
      tamperAnalysis: this.buildTamperAnalysis(null, leakVerify),
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

  private buildTamperAnalysis(
    comparison: Awaited<ReturnType<DnaComparisonService['compare']>> | null,
    leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>>,
  ): TamperAnalysisSection {
    const vectors = [
      { label: 'Compression', detected: false },
      { label: 'Crop', detected: false },
      { label: 'Resize', detected: false },
      { label: 'Screenshot', detected: leakVerify.leakVector === 'SCREENSHOT' },
      { label: 'Screen Recording', detected: leakVerify.leakVector === 'RECORDING' },
      { label: 'Metadata Removed', detected: false },
      { label: 'OCR Changes', detected: false },
      { label: 'AI Editing', detected: false },
      { label: 'AI Enhancement', detected: false },
      { label: 'Watermark Damage', detected: !!leakVerify.tampered && !!leakVerify.watermark },
      { label: 'Video Re-encoding', detected: false },
      { label: 'Audio Re-encoding', detected: false },
    ];

    if (comparison?.layerComparisons) {
      const l1 = comparison.layerComparisons.find((l) => l.layer === 1);
      const l3 = comparison.layerComparisons.find((l) => l.layer === 3);
      const l5 = comparison.layerComparisons.find((l) => l.layer === 5);
      const l11 = comparison.layerComparisons.find((l) => l.layer === 11);
      if (l1?.changed && l3 && l3.similarityPercent >= 85 && l3.similarityPercent < 99) vectors.find((v) => v.label === 'Compression')!.detected = true;
      if (l3 && l3.similarityPercent >= 55 && l3.similarityPercent < 85) {
        vectors.find((v) => v.label === 'Crop')!.detected = true;
        vectors.find((v) => v.label === 'Resize')!.detected = true;
      }
      if (l3 && l3.similarityPercent < 70) vectors.find((v) => v.label === 'Screenshot')!.detected = true;
      if (l5?.changed && !l1?.changed) vectors.find((v) => v.label === 'Metadata Removed')!.detected = true;
      if (l11?.changed || (l11 && l11.similarityPercent < 80)) vectors.find((v) => v.label === 'AI Enhancement')!.detected = true;
      if (l3 && l3.similarityPercent >= 70 && l3.similarityPercent < 92) vectors.find((v) => v.label === 'Sharpen')!.detected = true;
    }

    const extraVectors = [
      { label: 'Rotation', detected: false },
      { label: 'Blur', detected: false },
      { label: 'Contrast / Brightness', detected: false },
      { label: 'Color Filters', detected: false },
      { label: 'Format Conversion', detected: !!leakVerify.tampered },
      { label: 'Sharpen', detected: false },
    ];
    vectors.push(...extraVectors);

    let primaryVector = 'NONE';
    let overallTamperScore = 10;
    let description = 'No significant tampering detected';

    if (comparison?.layerComparisons) {
      const inputs = comparison.layerComparisons.slice(0, 6).map((l) => ({
        layer: l.name,
        score: l.similarityScore,
        weight: 0.15,
        passed: l.matched,
      }));
      const t = tamperClassifierService.classify(inputs);
      primaryVector = t.primaryVector;
      overallTamperScore = t.tamperConfidence;
      description = t.description;
    } else if (leakVerify.tampered) {
      primaryVector = 'COPY_PASTE';
      overallTamperScore = 55;
      description = 'File modified from protected original';
    }

    return { primaryVector, overallTamperScore, vectors, description };
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
