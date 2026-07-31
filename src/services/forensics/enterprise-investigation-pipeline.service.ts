/**
 * Enterprise Investigation Pipeline (Milestone G).
 *
 * Single-pass orchestration of completed modules:
 *   Generation (probe) → Storage load (vault SSoT) → Retrieval → Comparison → Acceptance → Report
 *
 * No new forensic algorithms, layers, or scoring.
 * Legacy multi-pass recovery remains when ENTERPRISE_PIPELINE_V2 is OFF.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import {
  ENTERPRISE_FEATURE_FLAG,
  isEnterpriseFeatureEnabled,
} from '../../config/enterprise-feature-flags';
import {
  parseEnterpriseDnaPackage,
  validateEnterpriseDnaPackage,
} from '../dna/enterprise-dna-package.service';
import {
  isEnterprisePackageUsableForInvestigation,
} from './investigation-stored-dna-source.service';
import { enterpriseCandidateRetrievalService } from './enterprise-candidate-retrieval.service';
import type { EnterpriseRecallResult } from './enterprise-candidate-retrieval.service';
import { forensicImagePreprocessor } from './forensic-image-preprocessor.service';
import type { ForensicImageVariant } from './forensic-image-preprocessor.service';
import {
  enterpriseComparisonEngine,
} from '../verification/enterprise-comparison-engine.service';
import { EphemeralFingerprinter } from '../verification/ephemeral-fingerprinter';
import type { EphemeralFingerprint } from '../verification/ephemeral-fingerprinter';
import {
  decideEnterpriseAcceptance,
  mapEnterpriseVerdictToLegacy,
} from './enterprise-acceptance-engine.service';
import type { EnterpriseDnaPackage } from '../../types/enterprise-dna-package.types';
import type { EnterpriseComparisonReport } from '../../types/enterprise-comparison.types';
import type { EnterpriseAcceptanceDecision } from '../../types/enterprise-acceptance.types';
import type {
  EnterpriseInvestigationReport,
  EnterprisePipelineCandidateOutcome,
  EnterprisePipelineInput,
  EnterprisePipelineRunResult,
  EnterprisePipelineStageName,
  EnterprisePipelineStageResult,
  EnterprisePipelineStageStatus,
} from '../../types/enterprise-investigation-pipeline.types';
import type {
  PinitIdentificationResult,
  RecoveryStage,
  RecoveredIdentitySignal,
} from './pinit-identification-engine.service';
import type { DeepCompareResult } from './deep-vault-compare.service';
import type { FusionResult, ForensicVerdict } from './confidence-fusion-engine.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import { buildAuthoritativeAsset } from './authoritative-asset.service';
import type { AuthoritativeAsset } from '../../types/authoritative-asset.types';

const DEFAULT_DEEP_COMPARE_LIMIT = 5;

export function isEnterprisePipelineV2Enabled(): boolean {
  return isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.ENTERPRISE_PIPELINE_V2);
}

export interface EnterpriseInvestigationPipelineDeps {
  fingerprintProbe(input: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  }): Promise<EphemeralFingerprint>;
  generateVariants(
    buffer: Buffer,
    mimeType: string,
  ): Promise<ForensicImageVariant[]>;
  retrieve(input: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
    ownerUserId: string;
    variants: ForensicImageVariant[];
    finalLimit?: number;
  }): Promise<EnterpriseRecallResult>;
  loadStoredPackage(dnaRecordId: string): Promise<{
    pkg: EnterpriseDnaPackage | null;
    packageStatus: EnterprisePipelineCandidateOutcome['packageStatus'];
    detail: string;
  }>;
  compare(
    stored: EnterpriseDnaPackage,
    probe: EphemeralFingerprint,
  ): EnterpriseComparisonReport;
  accept(input: {
    report: EnterpriseComparisonReport;
    packageMissing?: boolean;
    packageCorrupted?: boolean;
  }): EnterpriseAcceptanceDecision;
}

function nowIso(): string {
  return new Date().toISOString();
}

function beginStage(stage: EnterprisePipelineStageName): {
  stage: EnterprisePipelineStageName;
  startedAt: string;
  t0: number;
} {
  return { stage, startedAt: nowIso(), t0: Date.now() };
}

function endStage(
  begun: { stage: EnterprisePipelineStageName; startedAt: string; t0: number },
  status: EnterprisePipelineStageStatus,
  detail: string,
): EnterprisePipelineStageResult {
  return {
    stage: begun.stage,
    status,
    detail,
    durationMs: Date.now() - begun.t0,
    startedAt: begun.startedAt,
    finishedAt: nowIso(),
  };
}

async function defaultLoadStoredPackage(dnaRecordId: string): Promise<{
  pkg: EnterpriseDnaPackage | null;
  packageStatus: EnterprisePipelineCandidateOutcome['packageStatus'];
  detail: string;
}> {
  const record = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    select: { universalFingerprints: true },
  });
  if (!record) {
    return { pkg: null, packageStatus: 'MISSING', detail: 'dna_record_not_found' };
  }
  const pkg = parseEnterpriseDnaPackage(record.universalFingerprints);
  if (!pkg) {
    return { pkg: null, packageStatus: 'LEGACY', detail: 'missing_enterprise_package' };
  }
  const usable = isEnterprisePackageUsableForInvestigation(pkg);
  if (!usable.ok) {
    const validation = validateEnterpriseDnaPackage(pkg);
    return {
      pkg,
      packageStatus: usable.integrityValid === false || !validation.ok
        ? 'CORRUPTED'
        : 'LEGACY',
      detail: usable.reason,
    };
  }
  return { pkg, packageStatus: 'SEALED', detail: 'enterprise_package_valid' };
}

export function createDefaultPipelineDeps(): EnterpriseInvestigationPipelineDeps {
  const fingerprinter = new EphemeralFingerprinter();
  return {
    fingerprintProbe: (input) =>
      fingerprinter.fingerprint({
        filePath: '',
        buffer: input.buffer,
        originalName: input.originalName,
        declaredMimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      }),
    generateVariants: async (buffer, mimeType) => {
      if (!mimeType.startsWith('image/')) {
        return [{ label: 'original', buffer, mimeType }];
      }
      return forensicImagePreprocessor.generateVariants(buffer, mimeType, {
        fast: true,
        minimal: true,
        scanner: false,
      });
    },
    retrieve: (input) => enterpriseCandidateRetrievalService.retrieve(input),
    loadStoredPackage: defaultLoadStoredPackage,
    compare: (stored, probe) =>
      enterpriseComparisonEngine.compareStoredVsEphemeral(stored, probe),
    accept: (input) => decideEnterpriseAcceptance(input),
  };
}

function mapVerdictToForensic(
  decision: EnterpriseAcceptanceDecision | null,
): ForensicVerdict {
  if (!decision) return 'NO_SIGNATURE';
  switch (decision.verdict) {
    case 'VERIFIED_OWNER':
    case 'VERIFIED_COPY':
      return 'ORIGINAL_VERIFIED';
    case 'DERIVATIVE':
      return 'ORIGINAL_FOUND_PARTIAL';
    case 'POSSIBLE_MATCH':
      return 'POSSIBLE_ASSET';
    default:
      return 'NO_SIGNATURE';
  }
}

function mapVerdictToReportState(
  decision: EnterpriseAcceptanceDecision | null,
): PinitIdentificationResult['reportState'] {
  if (!decision) return 'NO_SIGNATURE';
  if (
    decision.verdict === 'VERIFIED_OWNER'
    || decision.verdict === 'VERIFIED_COPY'
    || decision.verdict === 'DERIVATIVE'
  ) {
    return 'VERIFIED';
  }
  if (decision.verdict === 'POSSIBLE_MATCH') return 'POSSIBLE';
  return 'NO_SIGNATURE';
}

function fusionFromDomains(
  decision: EnterpriseAcceptanceDecision | null,
  retrievalScore: number,
): FusionResult {
  const identity = decision?.domains.identityScore ?? 0;
  const ownership = decision?.domains.ownershipScore ?? 0;
  const evidence = decision?.domains.evidenceScore ?? 0;
  const trust = decision?.domains.trustScore ?? 0;
  const retrievalConfidence = Math.max(retrievalScore, identity);
  return {
    ownershipConfidence: ownership,
    retrievalConfidence,
    identityConfidence: identity,
    ownershipVerificationConfidence: ownership,
    trustScore: trust,
    highConfidence: !!(decision?.retainCandidate && identity >= 75),
    forensicVerdict: mapVerdictToForensic(decision),
    fusionMode: 'enterprise',
    breakdown: [
      { label: 'identity', score: identity, weight: 1, contribution: identity },
      { label: 'evidence', score: evidence, weight: 1, contribution: evidence },
      { label: 'ownership', score: ownership, weight: 1, contribution: ownership },
      { label: 'trust', score: trust, weight: 1, contribution: trust },
    ],
  };
}

function deepCompareFromEnterprise(
  vaultId: string,
  dnaRecordId: string,
  comparison: EnterpriseComparisonReport,
  acceptance?: EnterpriseAcceptanceDecision,
): DeepCompareResult {
  const matched = comparison.layers.filter((l) => l.status === 'MATCH').length;
  const peak = Math.max(
    comparison.domains.identityScore,
    comparison.domains.evidenceScore,
    comparison.domains.ownershipScore,
    comparison.domains.trustScore,
  );
  return {
    vaultId,
    dnaRecordId,
    overallConfidenceScore: peak,
    classification: acceptance?.verdict ?? 'COMPARED',
    tamperingDetected: comparison.layers.some((l) => l.status === 'MISMATCH'),
    matchedLayerCount: matched,
    totalLayers: comparison.layers.length,
    layerComparisons: comparison.layers.map((l) => ({
      layer: l.layerId,
      name: l.layerName,
      similarityPercent: l.score,
      matched: l.status === 'MATCH',
      skipped: l.status === 'NOT_PRESENT',
    })),
    enterpriseComparison: comparison,
  };
}

function candidateToMatch(
  candidate: RankedVaultCandidate,
  confidence: string,
): VaultMatchResult {
  return {
    tier: (candidate.tier === 1 || candidate.tier === 2 || candidate.tier === 3 || candidate.tier === 4)
      ? candidate.tier
      : 2,
    method: candidate.method,
    dnaRecordId: candidate.dnaRecordId,
    vaultId: candidate.vaultId,
    ownerUserId: candidate.ownerUserId,
    confidence,
  };
}

function stagesToRecovery(stages: EnterprisePipelineStageResult[]): RecoveryStage[] {
  return stages.map((s) => ({
    stage: s.stage,
    status:
      s.status === 'SUCCESS'
        ? 'complete'
        : s.status === 'WARNING' || s.status === 'SKIPPED'
          ? 'partial'
          : 'failed',
    detail: `${s.status}: ${s.detail} (${s.durationMs}ms)`,
  }));
}

/**
 * Pick best outcome: prefer retainCandidate, then identity, then ownership.
 */
export function selectBestCandidateOutcome(
  outcomes: EnterprisePipelineCandidateOutcome[],
): EnterprisePipelineCandidateOutcome | null {
  if (!outcomes.length) return null;
  const ranked = [...outcomes].sort((a, b) => {
    const aRetain = a.acceptance?.retainCandidate ? 1 : 0;
    const bRetain = b.acceptance?.retainCandidate ? 1 : 0;
    if (bRetain !== aRetain) return bRetain - aRetain;
    const aId = a.acceptance?.domains.identityScore
      ?? a.comparison?.domains.identityScore
      ?? 0;
    const bId = b.acceptance?.domains.identityScore
      ?? b.comparison?.domains.identityScore
      ?? 0;
    if (bId !== aId) return bId - aId;
    const aOwn = a.acceptance?.domains.ownershipScore
      ?? a.comparison?.domains.ownershipScore
      ?? 0;
    const bOwn = b.acceptance?.domains.ownershipScore
      ?? b.comparison?.domains.ownershipScore
      ?? 0;
    return bOwn - aOwn;
  });
  return ranked[0] ?? null;
}

export class EnterpriseInvestigationPipeline {
  constructor(private readonly deps: EnterpriseInvestigationPipelineDeps = createDefaultPipelineDeps()) {}

  async run(input: EnterprisePipelineInput): Promise<EnterprisePipelineRunResult> {
    const pipelineStarted = Date.now();
    const investigationId = input.investigationId ?? uuidv4();
    const stages: EnterprisePipelineStageResult[] = [];
    const deepLimit = Math.max(1, input.deepCompareLimit ?? DEFAULT_DEEP_COMPARE_LIMIT);

    logger.info('[EnterprisePipeline] started', {
      investigationId: investigationId.slice(0, 8),
      ownerUserId: input.ownerUserId.slice(0, 8),
      mimeType: input.mimeType,
    });

    // ── 1. INIT ────────────────────────────────────────────────────────────
    {
      const begun = beginStage('init');
      stages.push(endStage(begun, 'SUCCESS', `investigationId=${investigationId}`));
    }

    // ── 2. GENERATION CONTEXT (probe fingerprint once) ─────────────────────
    let probeFp: EphemeralFingerprint | null = null;
    {
      const begun = beginStage('generation_context');
      try {
        probeFp = await this.deps.fingerprintProbe({
          buffer: input.buffer,
          mimeType: input.mimeType,
          originalName: input.originalName,
          sizeBytes: input.sizeBytes,
        });
        const okLayers = probeFp.layers.filter((l) => l.success).length;
        stages.push(endStage(
          begun,
          okLayers >= 3 ? 'SUCCESS' : 'WARNING',
          `probe fingerprint once · ${okLayers}/15 layers`,
        ));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stages.push(endStage(begun, 'FAILED', `probe fingerprint failed: ${msg}`));
        logger.warn('[EnterprisePipeline] generation_context failed', {
          investigationId: investigationId.slice(0, 8),
          error: msg,
        });
      }
    }

    // ── 3. STORAGE LOAD (vault packages loaded per candidate; no vault regen) ─
    {
      const begun = beginStage('storage_load');
      stages.push(endStage(
        begun,
        'SUCCESS',
        'vault packages loaded from sealed enterpriseDnaPackage (no vault regen)',
      ));
    }

    // ── 4. RETRIEVAL (once) ────────────────────────────────────────────────
    let recall: EnterpriseRecallResult = {
      candidates: [],
      providerResults: [],
      localDnaHits: [],
      visualVectors: [],
      mergedCandidateCount: 0,
      finalCandidateCount: 0,
    };
    {
      const begun = beginStage('retrieval');
      try {
        const variants = await this.deps.generateVariants(input.buffer, input.mimeType);
        recall = await this.deps.retrieve({
          buffer: input.buffer,
          mimeType: input.mimeType,
          originalName: input.originalName,
          sizeBytes: input.sizeBytes,
          ownerUserId: input.ownerUserId,
          variants,
          finalLimit: 100,
        });
        const providerErrors = recall.providerResults.filter((p) => p.error).length;
        stages.push(endStage(
          begun,
          providerErrors > 0 && recall.candidates.length === 0
            ? 'FAILED'
            : providerErrors > 0
              ? 'WARNING'
              : 'SUCCESS',
          `providers=${recall.providerResults.length} merged=${recall.mergedCandidateCount} final=${recall.finalCandidateCount}`,
        ));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stages.push(endStage(begun, 'FAILED', `retrieval failed: ${msg}`));
        logger.warn('[EnterprisePipeline] retrieval failed', {
          investigationId: investigationId.slice(0, 8),
          error: msg,
        });
      }
    }

    // ── 5–6. COMPARISON + ACCEPTANCE (once per selected candidate) ─────────
    const toCompare = recall.candidates.slice(0, deepLimit);
    const outcomes: EnterprisePipelineCandidateOutcome[] = [];
    let comparisonStatus: EnterprisePipelineStageStatus = toCompare.length ? 'SUCCESS' : 'SKIPPED';
    let comparisonDetail = toCompare.length
      ? `compared ${toCompare.length} candidates`
      : 'no candidates to compare';
    let acceptanceStatus: EnterprisePipelineStageStatus = toCompare.length ? 'SUCCESS' : 'SKIPPED';
    let acceptanceDetail = toCompare.length
      ? `acceptance evaluated for ${toCompare.length} candidates`
      : 'no candidates for acceptance';

    const compareBegun = beginStage('comparison');
    const acceptBegun = beginStage('acceptance');
    let compareErrors = 0;
    let acceptErrors = 0;
    let sealedUsed = 0;

    for (const candidate of toCompare) {
      const loaded = await this.deps.loadStoredPackage(candidate.dnaRecordId);
      if (loaded.packageStatus === 'SEALED') sealedUsed += 1;

      let comparison: EnterpriseComparisonReport | undefined;
      let acceptance: EnterpriseAcceptanceDecision | undefined;

      if (loaded.pkg && probeFp) {
        try {
          comparison = this.deps.compare(loaded.pkg, probeFp);
          if (loaded.packageStatus !== 'SEALED') {
            comparisonStatus = 'WARNING';
          }
        } catch (err) {
          compareErrors += 1;
          logger.warn('[EnterprisePipeline] comparison failed', {
            investigationId: investigationId.slice(0, 8),
            vaultId: candidate.vaultId.slice(0, 8),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (comparison) {
        try {
          acceptance = this.deps.accept({
            report: comparison,
            packageMissing: loaded.packageStatus === 'MISSING' || loaded.packageStatus === 'LEGACY',
            packageCorrupted: loaded.packageStatus === 'CORRUPTED',
          });
        } catch (err) {
          acceptErrors += 1;
          logger.warn('[EnterprisePipeline] acceptance failed', {
            investigationId: investigationId.slice(0, 8),
            vaultId: candidate.vaultId.slice(0, 8),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      outcomes.push({
        vaultId: candidate.vaultId,
        dnaRecordId: candidate.dnaRecordId,
        packageStatus: loaded.packageStatus,
        comparison,
        acceptance,
      });
    }

    if (compareErrors > 0 && outcomes.every((o) => !o.comparison)) {
      comparisonStatus = 'FAILED';
      comparisonDetail = `all comparisons failed (${compareErrors})`;
    } else if (compareErrors > 0) {
      comparisonStatus = 'WARNING';
      comparisonDetail = `compared with ${compareErrors} error(s); sealed=${sealedUsed}`;
    } else if (toCompare.length) {
      comparisonDetail = `compared ${outcomes.filter((o) => o.comparison).length}/${toCompare.length}; sealed=${sealedUsed}`;
    }

    if (acceptErrors > 0 && outcomes.every((o) => !o.acceptance)) {
      acceptanceStatus = 'FAILED';
      acceptanceDetail = `all acceptance evaluations failed (${acceptErrors})`;
    } else if (acceptErrors > 0) {
      acceptanceStatus = 'WARNING';
      acceptanceDetail = `acceptance with ${acceptErrors} error(s)`;
    } else if (toCompare.length) {
      acceptanceDetail = `accepted ${outcomes.filter((o) => o.acceptance).length}/${toCompare.length}`;
    }

    stages.push(endStage(compareBegun, comparisonStatus, comparisonDetail));
    stages.push(endStage(acceptBegun, acceptanceStatus, acceptanceDetail));

    // ── 7. REPORT ──────────────────────────────────────────────────────────
    const best = selectBestCandidateOutcome(outcomes);
    const acceptanceDecision = best?.acceptance ?? null;
    const bestComparison = best?.comparison ?? null;

    const reportBegun = beginStage('report');
    const report: EnterpriseInvestigationReport = {
      schema: 'enterprise-investigation-report-v1',
      investigationId,
      ownerUserId: input.ownerUserId,
      probeFilename: input.originalName,
      probeMimeType: input.mimeType,
      packageValidation: {
        status: sealedUsed > 0
          ? 'SUCCESS'
          : outcomes.some((o) => o.packageStatus === 'CORRUPTED')
            ? 'FAILED'
            : outcomes.length === 0
              ? 'SKIPPED'
              : 'WARNING',
        detail: sealedUsed > 0
          ? `${sealedUsed} sealed package(s) used as SSoT`
          : outcomes.length === 0
            ? 'no candidates — package validation skipped'
            : 'no sealed packages — legacy/missing rows',
        storedPackageUsed: sealedUsed > 0,
      },
      retrievalSummary: {
        providerCount: recall.providerResults.length,
        mergedCandidateCount: recall.mergedCandidateCount,
        finalCandidateCount: recall.finalCandidateCount,
        topVaultIds: recall.candidates.slice(0, 10).map((c) => c.vaultId),
      },
      comparisonSummary: {
        candidatesCompared: outcomes.filter((o) => o.comparison).length,
        bestIdentityScore: bestComparison?.domains.identityScore ?? 0,
        bestOwnershipScore: bestComparison?.domains.ownershipScore ?? 0,
        bestEvidenceScore: bestComparison?.domains.evidenceScore ?? 0,
        bestTrustScore: bestComparison?.domains.trustScore ?? 0,
      },
      acceptanceDecision,
      layerReport: bestComparison?.layers ?? null,
      evidence: {
        evidenceScore: acceptanceDecision?.domains.evidenceScore
          ?? bestComparison?.domains.evidenceScore
          ?? 0,
        evidenceLayers: acceptanceDecision?.explanation.triggeredLayers.filter((n) =>
          [5, 6, 9, 10, 11, 12, 13].includes(n),
        ) ?? [],
      },
      ownership: {
        ownershipScore: acceptanceDecision?.domains.ownershipScore
          ?? bestComparison?.domains.ownershipScore
          ?? 0,
        retainCandidate: acceptanceDecision?.retainCandidate ?? false,
        ownershipLayers: acceptanceDecision?.explanation.triggeredLayers.filter((n) =>
          [7, 8, 14].includes(n),
        ) ?? [],
      },
      trust: {
        trustScore: acceptanceDecision?.domains.trustScore
          ?? bestComparison?.domains.trustScore
          ?? 0,
      },
      candidates: recall.candidates,
      candidateOutcomes: outcomes,
      stages,
      totalExecutionMs: Date.now() - pipelineStarted,
      createdAt: nowIso(),
      pipelineVersion: 'enterprise-pipeline-v2',
    };

    stages.push(endStage(
      reportBegun,
      'SUCCESS',
      `unified report · total=${report.totalExecutionMs}ms · verdict=${acceptanceDecision?.verdict ?? 'none'}`,
    ));
    report.stages = [...stages];
    report.totalExecutionMs = Date.now() - pipelineStarted;

    logger.info('[EnterprisePipeline] finished', {
      investigationId: investigationId.slice(0, 8),
      totalExecutionMs: report.totalExecutionMs,
      verdict: acceptanceDecision?.verdict ?? null,
      candidates: recall.finalCandidateCount,
      compared: report.comparisonSummary.candidatesCompared,
    });

    return { report, investigationId };
  }

  /**
   * Adapt enterprise report → legacy PinitIdentificationResult (API/UI stable).
   */
  async toIdentificationResult(
    run: EnterprisePipelineRunResult,
    input: EnterprisePipelineInput,
  ): Promise<PinitIdentificationResult> {
    const { report } = run;
    const best = selectBestCandidateOutcome(report.candidateOutcomes);
    const decision = report.acceptanceDecision;
    const ranked = best
      ? report.candidates.find((c) => c.vaultId === best.vaultId) ?? report.candidates[0]
      : report.candidates[0];

    const retrievalScore = ranked?.compositeScore ?? ranked?.preliminaryScore ?? 0;
    const fusion = fusionFromDomains(decision, retrievalScore);
    const reportState = mapVerdictToReportState(decision);
    void (decision ? mapEnterpriseVerdictToLegacy(decision.verdict) : null);

    let match: VaultMatchResult | null = null;
    if (ranked && decision?.retainCandidate) {
      match = candidateToMatch(
        ranked,
        decision.verdict === 'VERIFIED_OWNER' || decision.verdict === 'VERIFIED_COPY'
          ? 'EXACT'
          : 'HIGH',
      );
    } else if (ranked && reportState === 'POSSIBLE') {
      match = candidateToMatch(ranked, 'POSSIBLE');
    }

    const verifiedCandidate = match;
    const deepCompareResults: DeepCompareResult[] = report.candidateOutcomes
      .filter((o) => o.comparison)
      .map((o) => deepCompareFromEnterprise(
        o.vaultId,
        o.dnaRecordId,
        o.comparison!,
        o.acceptance,
      ));

    const bestDeepCompare = best?.comparison
      ? deepCompareFromEnterprise(best.vaultId, best.dnaRecordId, best.comparison, best.acceptance)
      : null;

    let authoritativeAsset: AuthoritativeAsset | null = null;
    if (match) {
      try {
        authoritativeAsset = await buildAuthoritativeAsset({
          selection: { match, source: 'deep_compare' },
          deepCompareResults,
          vectors: [],
          candidates: report.candidates,
          localDnaHit: null,
          ownerUserId: input.ownerUserId,
        });
      } catch (err) {
        logger.warn('[EnterprisePipeline] authoritative asset build skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const recoveredSignals: RecoveredIdentitySignal[] = report.stages.map((s) => ({
      stage: s.stage,
      score: s.status === 'SUCCESS' ? 100 : s.status === 'WARNING' ? 50 : 0,
      recovered: s.status === 'SUCCESS' || s.status === 'WARNING',
      detail: s.detail,
    }));

    const identified = reportState === 'VERIFIED' && !!match;
    const ownerShortId = authoritativeAsset?.ownerPinitId ?? null;

    return {
      match: identified || reportState === 'POSSIBLE' ? match : null,
      probableMatch: reportState === 'POSSIBLE' ? match : null,
      verifiedCandidate,
      bestCandidate: verifiedCandidate,
      reportState,
      reportStateReason: decision
        ? `${decision.ruleId}: ${decision.explanation.reason}`
        : 'Enterprise pipeline — no acceptance decision',
      candidates: report.candidates,
      fusion,
      stages: stagesToRecovery(report.stages),
      variantCount: 1,
      manifestRecovered: false,
      identityTokenRecovered: false,
      watermarkRecovered: false,
      identified,
      highConfidence: fusion.highConfidence,
      recoveredSignals,
      deepCompareResults,
      certificateId: authoritativeAsset?.certificateId ?? null,
      ownerShortId,
      tamperingSummary: bestDeepCompare?.tamperingDetected
        ? 'Layer mismatches detected in enterprise comparison'
        : null,
      bestDeepCompare,
      stageTimings: report.stages.map((s) => ({
        stage: s.stage,
        durationMs: s.durationMs,
        detail: s.detail,
      })),
      authoritativeAsset,
      auditContext: {
        vectors: [],
        vaultRecordIds: report.candidates.map((c) => c.vaultId),
        selectionSteps: [{
          stage: 'enterprise_pipeline_v2',
          vaultId: match?.vaultId ?? null,
          dnaRecordId: match?.dnaRecordId ?? null,
          detail: `investigationId=${report.investigationId}`,
        }],
        identityHit: match,
        localDnaHit: null,
      },
      enterpriseInvestigationReport: report,
    };
  }
}

export const enterpriseInvestigationPipeline = new EnterpriseInvestigationPipeline();
