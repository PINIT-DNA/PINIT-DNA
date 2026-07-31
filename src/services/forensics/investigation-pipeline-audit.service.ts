/**
 * Investigation pipeline audit — structured trace + consistency diagnosis.
 * No threshold changes; logging and report attachment only.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { VaultSimilarityVector } from './vault-similarity-vector.service';
import type { DeepCompareResult } from './deep-vault-compare.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type {
  CandidateRetrievalAudit,
  CandidateScoreAudit,
  InvestigationPipelineAudit,
  PipelineDiagnosis,
  ReportConsistencyAudit,
  RetrievalSelectionStep,
} from '../../types/investigation-pipeline-audit.types';

export interface BuildAuditInput {
  probeFilename: string;
  probeSha256: string;
  probeMimeType: string;
  probeSizeBytes: number;
  vaultRecordIds: string[];
  vectors?: VaultSimilarityVector[];
  candidates: RankedVaultCandidate[];
  deepCompareResults: DeepCompareResult[];
  localDnaHit?: {
    vaultId: string;
    dnaRecordId: string;
    ownerUserId: string;
    compositeScore: number;
    patchMatchCount: number;
    orbRefineScore?: number;
    geometricScore?: number;
  } | null;
  identityHit?: VaultMatchResult | null;
  verifiedCandidate?: VaultMatchResult | null;
  matchBeforeOverride?: VaultMatchResult | null;
  matchAfterOverride?: VaultMatchResult | null;
  certificateId?: string | null;
  certificateLookupVaultId?: string | null;
  selectionSteps: RetrievalSelectionStep[];
}

export interface ReportAuditInput {
  reportVaultId?: string;
  reportDnaRecordId?: string;
  reportCertificateId?: string | null;
  reportOriginalFilename?: string | null;
  verifiedCandidate?: VaultMatchResult | null;
  matchAfterOverride?: VaultMatchResult | null;
  enterpriseCertificateId?: string | null;
  bestDeepCompare?: DeepCompareResult | null;
  resolvedCertificate?: { certificateId: string; dnaRecordId?: string; vaultId?: string } | null;
}

async function enrichCandidate(
  c: RankedVaultCandidate,
  rank: number,
  vectors: VaultSimilarityVector[],
  deepCompareResults: DeepCompareResult[],
  localDnaHit?: BuildAuditInput['localDnaHit'],
): Promise<CandidateRetrievalAudit> {
  const vec = vectors.find((v) => v.vaultId === c.vaultId);
  const deep = deepCompareResults.find((d) => d.vaultId === c.vaultId);

  const [vaultRow, cert, owner] = await Promise.all([
    prisma.vaultRecord.findUnique({
      where: { id: c.vaultId },
      select: { encryptedFilePath: true, originalFileName: true },
    }),
    prisma.certificate.findFirst({
      where: { vaultId: c.vaultId, status: 'ACTIVE' },
      select: { certificateId: true },
    }),
    prisma.user.findUnique({
      where: { id: c.ownerUserId },
      select: { shortId: true },
    }),
  ]);

  const scores: CandidateScoreAudit = {
    composite: vec?.scores.composite ?? c.compositeScore,
    pHash: vec?.scores.pHash,
    aHash: vec?.scores.aHash,
    dHash: vec?.scores.dHash,
    perceptualBlend: vec?.scores.perceptualBlend,
    structural: vec?.scores.structural,
    orb: vec?.scores.orb,
    clip: vec?.scores.clip,
    semanticColor: vec?.scores.semanticColor,
    sha256: vec?.scores.sha256,
    dna15Overall: deep?.overallConfidenceScore,
    dna15MatchedLayers: deep?.matchedLayerCount,
    dna15TotalLayers: deep?.totalLayers,
    layerScores: deep?.layerComparisons,
  };

  if (localDnaHit?.vaultId === c.vaultId) {
    scores.patchDna = localDnaHit.compositeScore;
    scores.patchVotes = localDnaHit.patchMatchCount;
    scores.geometricScore = localDnaHit.geometricScore;
    scores.orb = Math.max(scores.orb ?? 0, localDnaHit.orbRefineScore ?? 0);
  }

  return {
    rank,
    vaultId: c.vaultId,
    dnaRecordId: c.dnaRecordId,
    ownerUserId: c.ownerUserId,
    ownerPinitId: owner?.shortId ?? null,
    originalFilename: vaultRow?.originalFileName ?? vec?.filename ?? null,
    certificateId: cert?.certificateId ?? null,
    storagePath: vaultRow?.encryptedFilePath ?? null,
    scores,
    selected: c.selected,
  };
}

function formatTrace(
  probe: BuildAuditInput,
  ranking: CandidateRetrievalAudit[],
  winning: CandidateRetrievalAudit | null,
  consistency: ReportConsistencyAudit,
): string {
  const lines: string[] = [
    '═══ PINIT Investigation Pipeline Audit Trace ═══',
    '',
    'Probe Image',
    `  filename: ${probe.probeFilename}`,
    `  sha256:   ${probe.probeSha256}`,
    `  mime:     ${probe.probeMimeType}`,
    `  size:     ${probe.probeSizeBytes} bytes`,
    '',
    `Vault records loaded: ${probe.vaultRecordIds.length}`,
    ...probe.vaultRecordIds.slice(0, 20).map((id, i) => `  [${i + 1}] ${id}`),
    ...(probe.vaultRecordIds.length > 20 ? [`  ... +${probe.vaultRecordIds.length - 20} more`] : []),
    '',
    'Retrieval selection steps:',
    ...probe.selectionSteps.map((s) =>
      `  • ${s.stage}: vault=${s.vaultId ?? '—'} dna=${s.dnaRecordId ?? '—'} cert=${s.certificateId ?? '—'} ${s.detail ?? ''}`.trim(),
    ),
    '',
    'Candidate ranking:',
  ];

  for (const c of ranking.slice(0, 10)) {
    lines.push(
      `  #${c.rank} vault=${c.vaultId.slice(0, 8)}… dna=${c.dnaRecordId.slice(0, 8)}…`,
      `      file=${c.originalFilename ?? '?'}`,
      `      composite=${c.scores.composite ?? '—'} pHash=${c.scores.pHash ?? '—'} dHash=${c.scores.dHash ?? '—'} aHash=${c.scores.aHash ?? '—'}`,
      `      structural=${c.scores.structural ?? '—'} orb=${c.scores.orb ?? '—'} patchDna=${c.scores.patchDna ?? '—'} patchVotes=${c.scores.patchVotes ?? '—'}`,
      `      dna15=${c.scores.dna15Overall ?? '—'}% (${c.scores.dna15MatchedLayers ?? 0}/${c.scores.dna15TotalLayers ?? 0} layers)`,
    );
    if (c.scores.layerScores?.length) {
      const layerLine = c.scores.layerScores
        .map((l) => `L${l.layer}:${l.similarityPercent}%`)
        .join(' ');
      lines.push(`      layers: ${layerLine}`);
    }
    if (c.selected) lines.push('      ★ SELECTED FOR REPORT');
    lines.push('');
  }

  if (winning) {
    lines.push(
      'Winning candidate (report):',
      `  vaultId:       ${winning.vaultId}`,
      `  dnaRecordId:   ${winning.dnaRecordId}`,
      `  certificateId: ${winning.certificateId ?? '—'}`,
      `  filename:      ${winning.originalFilename ?? '—'}`,
      `  final confidence: composite=${winning.scores.composite ?? '—'} dna15=${winning.scores.dna15Overall ?? '—'}`,
      '',
    );
  }

  lines.push(
    'Report consistency:',
    `  diagnosis: ${consistency.diagnosis}`,
    ...consistency.mismatches.map((m) => `  ⚠ ${m}`),
    '',
    '      ↓',
    'Final report',
  );

  return lines.join('\n');
}

export function auditReportConsistency(input: ReportAuditInput): ReportConsistencyAudit {
  const mismatches: string[] = [];

  const retrievalVault = input.verifiedCandidate?.vaultId ?? null;
  const retrievalDna = input.verifiedCandidate?.dnaRecordId ?? null;

  if (input.reportVaultId && retrievalVault && input.reportVaultId !== retrievalVault) {
    mismatches.push(`Report vault ${input.reportVaultId} ≠ retrieval verifiedCandidate ${retrievalVault}`);
  }
  if (input.reportDnaRecordId && retrievalDna && input.reportDnaRecordId !== retrievalDna) {
    mismatches.push(`Report DNA ${input.reportDnaRecordId} ≠ retrieval DNA ${retrievalDna}`);
  }
  if (
    input.matchAfterOverride?.vaultId
    && retrievalVault
    && input.matchAfterOverride.vaultId !== retrievalVault
  ) {
    mismatches.push(
      `Internal match override vault ${input.matchAfterOverride.vaultId} ≠ verifiedCandidate ${retrievalVault}`,
    );
  }
  if (
    input.enterpriseCertificateId
    && input.resolvedCertificate?.certificateId
    && input.enterpriseCertificateId !== input.resolvedCertificate.certificateId
    && input.resolvedCertificate.vaultId
    && input.resolvedCertificate.vaultId !== input.reportVaultId
  ) {
    mismatches.push(
      `enterprise.certificateId resolved for vault ${input.resolvedCertificate.vaultId} but report uses vault ${input.reportVaultId}`,
    );
  }
  if (
    input.resolvedCertificate?.vaultId
    && input.reportVaultId
    && input.resolvedCertificate.vaultId !== input.reportVaultId
  ) {
    mismatches.push(
      `Certificate vault ${input.resolvedCertificate.vaultId} ≠ report vault ${input.reportVaultId}`,
    );
  }
  if (
    input.resolvedCertificate?.dnaRecordId
    && input.reportDnaRecordId
    && input.resolvedCertificate.dnaRecordId !== input.reportDnaRecordId
  ) {
    mismatches.push(
      `Certificate DNA ${input.resolvedCertificate.dnaRecordId} ≠ report DNA ${input.reportDnaRecordId}`,
    );
  }
  if (
    input.bestDeepCompare?.vaultId
    && input.reportVaultId
    && input.bestDeepCompare.vaultId !== input.reportVaultId
  ) {
    mismatches.push(
      `bestDeepCompare vault ${input.bestDeepCompare.vaultId} ≠ report vault ${input.reportVaultId} (scores may be from wrong vault)`,
    );
  }
  if (
    input.reportCertificateId
    && input.resolvedCertificate?.certificateId
    && input.reportCertificateId !== input.resolvedCertificate.certificateId
    && input.enterpriseCertificateId
    && input.reportCertificateId === input.enterpriseCertificateId
  ) {
    mismatches.push(
      `Report uses enterprise.certificateId ${input.reportCertificateId} which may belong to a different vault than report metadata`,
    );
  }

  let diagnosis: PipelineDiagnosis = 'none';
  if (mismatches.some((m) => m.includes('Certificate') || m.includes('DNA') && m.includes('≠ report'))) {
    diagnosis = 'report_generation';
  } else if (mismatches.some((m) => m.includes('override') || m.includes('bestDeepCompare'))) {
    diagnosis = 'retrieval_ranking';
  } else if (mismatches.length) {
    diagnosis = 'retrieval_ranking';
  }

  const audit: ReportConsistencyAudit = {
    reportVaultId: input.reportVaultId,
    reportDnaRecordId: input.reportDnaRecordId,
    reportCertificateId: input.reportCertificateId,
    reportOriginalFilename: input.reportOriginalFilename,
    retrievalVaultId: retrievalVault,
    retrievalDnaRecordId: retrievalDna,
    certificateVaultId: input.resolvedCertificate?.vaultId ?? null,
    certificateDnaRecordId: input.resolvedCertificate?.dnaRecordId ?? null,
    certificateId: input.resolvedCertificate?.certificateId ?? input.enterpriseCertificateId ?? null,
    deepCompareVaultId: input.bestDeepCompare?.vaultId ?? null,
    deepCompareDnaRecordId: input.bestDeepCompare?.dnaRecordId ?? null,
    verifiedCandidateVaultId: retrievalVault,
    matchAfterOverrideVaultId: input.matchAfterOverride?.vaultId ?? null,
    mismatches,
    diagnosis,
  };

  if (mismatches.length) {
    logger.warn('[PipelineAudit] Report consistency mismatches', audit);
  } else {
    logger.info('[PipelineAudit] Report consistent with retrieval candidate', {
      vaultId: input.reportVaultId?.slice(0, 8),
      dnaRecordId: input.reportDnaRecordId?.slice(0, 8),
    });
  }

  return audit;
}

export async function buildInvestigationPipelineAudit(
  input: BuildAuditInput,
  reportConsistency: ReportConsistencyAudit,
): Promise<InvestigationPipelineAudit> {
  const vectors = input.vectors ?? [];
  const ranking = await Promise.all(
    input.candidates.map((c, i) =>
      enrichCandidate(c, i + 1, vectors, input.deepCompareResults, input.localDnaHit),
    ),
  );

  const winning = ranking.find((c) => c.selected)
    ?? (input.verifiedCandidate
      ? ranking.find((c) => c.vaultId === input.verifiedCandidate!.vaultId)
      : null)
    ?? ranking[0]
    ?? null;

  const audit: InvestigationPipelineAudit = {
    probeImage: {
      filename: input.probeFilename,
      sha256: input.probeSha256,
      mimeType: input.probeMimeType,
      sizeBytes: input.probeSizeBytes,
    },
    vaultRecordsLoaded: input.vaultRecordIds.length,
    vaultRecordIds: input.vaultRecordIds,
    candidateRanking: ranking,
    retrievalSelection: input.selectionSteps,
    winningCandidate: winning,
    reportConsistency,
    traceText: formatTrace(input, ranking, winning, reportConsistency),
  };

  logger.info('[PipelineAudit] Investigation trace\n' + audit.traceText);

  return audit;
}

export function logVaultRecordsLoaded(ownerUserId: string, vaultIds: string[]): void {
  logger.info('[PipelineAudit] Vault records loaded for scoring', {
    ownerUserId: ownerUserId.slice(0, 8),
    count: vaultIds.length,
    vaultIds: vaultIds.slice(0, 15).map((id) => id.slice(0, 8)),
  });
}

export function logVectorScores(vectors: VaultSimilarityVector[]): void {
  for (const [i, v] of vectors.slice(0, 20).entries()) {
    logger.info('[PipelineAudit] Vector candidate score', {
      rank: i + 1,
      vaultId: v.vaultId.slice(0, 8),
      dnaRecordId: v.dnaRecordId.slice(0, 8),
      filename: v.filename,
      composite: v.scores.composite,
      pHash: v.scores.pHash,
      dHash: v.scores.dHash,
      aHash: v.scores.aHash,
      perceptualBlend: v.scores.perceptualBlend,
      structural: v.scores.structural,
      orb: v.scores.orb,
      clip: v.scores.clip,
      sha256: v.scores.sha256,
    });
  }
}

export function logDeepCompareCandidate(
  vaultId: string,
  dnaRecordId: string,
  result: DeepCompareResult,
): void {
  logger.info('[PipelineAudit] Deep 15-layer compare', {
    vaultId: vaultId.slice(0, 8),
    dnaRecordId: dnaRecordId.slice(0, 8),
    overall: result.overallConfidenceScore,
    matchedLayers: result.matchedLayerCount,
    totalLayers: result.totalLayers,
    layers: result.layerComparisons?.map((l) => ({
      layer: l.layer,
      pct: l.similarityPercent,
      matched: l.matched,
    })),
  });
}
