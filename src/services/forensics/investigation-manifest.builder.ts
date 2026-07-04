/**
 * Builds an immutable Investigation Manifest from report + acceptance outcome.
 * Does not change matching or acceptance logic — only packages evidence.
 */
import { createHash } from 'crypto';
import type { InvestigationOutcome } from './investigation-decision-resolver.service';
import type { UnifiedInvestigationReport } from '../../types/unified-investigation.types';
import type {
  InvestigationManifest,
  ManifestCandidate,
  ManifestLifecycleEvent,
  ManifestMediaType,
  ManifestTamperFlag,
} from '../../types/investigation-manifest.types';
import {
  ACCEPTANCE_POLICY_VERSION,
  DNA_ALGORITHM_VERSION,
  INVESTIGATION_MANIFEST_VERSION,
} from '../../types/investigation-manifest.types';
import type { CandidateScoreLog } from './image-candidate-acceptance.service';

export interface ManifestBuildInput {
  report: UnifiedInvestigationReport;
  outcome: InvestigationOutcome;
  probeFilename: string;
  probeMimeType: string;
  probeSizeBytes: number;
  probeSha256?: string;
  candidateLogs?: CandidateScoreLog[];
}

function resolveMediaType(mime: string, filename: string): ManifestMediaType {
  const m = (mime || '').toLowerCase();
  const n = (filename || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|tiff?)$/i.test(n)) return 'image';
  if (m.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(n)) return 'video';
  if (m.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a)$/i.test(n)) return 'audio';
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/\.(docx?|pptx?|xlsx?|txt|csv)$/i.test(n)) return 'document';
  if (/\.(zip|rar|7z)$/i.test(n)) return 'archive';
  return 'unknown';
}

function probeIdFor(investigationId: string, sha256?: string): string {
  if (sha256) return createHash('sha256').update(`probe:${sha256}`).digest('hex').slice(0, 32);
  return investigationId;
}

function candidatesFromReport(
  report: UnifiedInvestigationReport,
  logs?: CandidateScoreLog[],
): ManifestCandidate[] {
  if (logs?.length) {
    return logs.map((l) => ({
      rank: l.rank,
      vaultId: l.vaultId,
      dnaRecordId: report.candidateRanking?.find((c) => c.vaultId === l.vaultId)?.dnaRecordId
        ?? report.owner.dnaRecordId
        ?? '',
      filename: l.filename,
      vectorSimilarity: l.vectorSimilarity,
      clipSimilarity: l.clipSimilarity,
      orbScore: l.orbScore,
      pHashSimilarity: l.pHashSimilarity,
      dnaScore: l.dnaScore,
      dnaClassification: l.dnaClassification,
      fusionScore: l.fusionScore,
      decision: l.decision,
      rejectReasons: l.rejectReasons,
    }));
  }

  return (report.candidateRanking ?? []).map((c) => ({
    rank: c.rank,
    vaultId: c.vaultId,
    dnaRecordId: c.dnaRecordId,
    filename: undefined,
    vectorSimilarity: c.compositeScore,
    clipSimilarity: 0,
    orbScore: 0,
    pHashSimilarity: 0,
    dnaScore: c.dnaMatchPercent ?? 0,
    dnaClassification: c.selected ? 'SELECTED' : 'CANDIDATE',
    fusionScore: c.compositeScore,
    decision: c.selected ? 'ACCEPT' as const : 'PENDING' as const,
    rejectReasons: [],
  }));
}

function tamperFlags(report: UnifiedInvestigationReport): ManifestTamperFlag[] {
  const vectors = report.tamperAnalysis?.vectors ?? [];
  if (!vectors.length) {
    return [
      { flag: 'Original', state: 'UNKNOWN' },
      { flag: 'Crop', state: 'UNKNOWN' },
      { flag: 'Resize', state: 'UNKNOWN' },
      { flag: 'Compression', state: 'UNKNOWN' },
      { flag: 'Screenshot', state: 'UNKNOWN' },
      { flag: 'WhatsApp', state: 'UNKNOWN' },
      { flag: 'Metadata Removed', state: 'UNKNOWN' },
      { flag: 'Watermark', state: 'UNKNOWN' },
    ];
  }
  return vectors.map((v) => ({
    flag: v.label,
    state: v.detected ? 'YES' as const : 'NO' as const,
  }));
}

const LIFECYCLE_STAGES = [
  'Created',
  'Encrypted',
  'DNA Generated',
  'Uploaded',
  'Stored',
  'Viewed',
  'Downloaded',
  'Shared',
  'Recovered',
  'Investigated',
  'Verified',
] as const;

function buildLifecycle(report: UnifiedInvestigationReport): ManifestLifecycleEvent[] {
  const access = report.accessIntelligence ?? [];
  const timeline = report.timeline ?? [];
  const events: ManifestLifecycleEvent[] = LIFECYCLE_STAGES.map((event) => {
    const fromTimeline = timeline.find((t) =>
      t.stage.toLowerCase().includes(event.toLowerCase().split(' ')[0]!),
    );
    const fromAccess = access.find((a) =>
      (a.action ?? '').toLowerCase().includes(event.toLowerCase().split(' ')[0]!),
    );
    if (event === 'Investigated') {
      return {
        event,
        timestamp: report.investigatedAt,
        detail: report.summary.acceptanceVerdict ?? report.summary.reportState,
        status: 'RECORDED' as const,
      };
    }
    if (event === 'Verified' && report.summary.acceptanceVerdict === 'VERIFIED_ORIGINAL') {
      return {
        event,
        timestamp: report.investigatedAt,
        detail: report.summary.decisionReason,
        status: 'RECORDED' as const,
      };
    }
    if (fromTimeline) {
      return {
        event,
        timestamp: fromTimeline.timestamp,
        detail: fromTimeline.detail,
        status: 'RECORDED' as const,
      };
    }
    if (fromAccess) {
      return {
        event,
        timestamp: fromAccess.timestamp,
        detail: fromAccess.action,
        status: 'RECORDED' as const,
      };
    }
    if (event === 'Stored' && report.owner.vaultId) {
      return {
        event,
        timestamp: report.owner.createdAt,
        detail: report.owner.vaultId,
        status: 'RECORDED' as const,
      };
    }
    if (event === 'DNA Generated' && report.owner.dnaRecordId) {
      return {
        event,
        timestamp: report.owner.createdAt,
        detail: report.owner.dnaRecordId,
        status: 'RECORDED' as const,
      };
    }
    return { event, status: 'N/A' as const };
  });
  return events;
}

function layerSlots(report: UnifiedInvestigationReport): InvestigationManifest['layers'] {
  const analysis = report.layerAnalysis ?? [];
  if (!analysis.length) {
    return Array.from({ length: 15 }, (_, i) => ({
      layer: i + 1,
      name: `Layer ${i + 1}`,
      state: 'SKIPPED' as const,
    }));
  }
  return analysis.map((l) => ({
    layer: l.layer,
    name: l.name,
    state: l.status === 'verified'
      ? 'PASS' as const
      : l.status === 'failed'
        ? 'FAIL' as const
        : 'SKIPPED' as const,
    score: l.matchPercent,
    explanation: l.explanation,
  }));
}

/**
 * Build immutable manifest. Call once per investigation before returning the report.
 */
export function buildInvestigationManifest(input: ManifestBuildInput): InvestigationManifest {
  const { report, outcome, probeFilename, probeMimeType, probeSizeBytes, probeSha256, candidateLogs } = input;
  const probeId = probeIdFor(report.investigationId, probeSha256 ?? report.currentFileHash);
  const mediaType = resolveMediaType(probeMimeType, probeFilename);
  const analysisComplete = outcome.acceptanceVerdict !== 'INSUFFICIENT_EVIDENCE';

  const accepted = outcome.candidate
    ? {
        vaultId: outcome.candidate.vaultId,
        dnaRecordId: outcome.candidate.dnaRecordId,
        ownerUserId: outcome.candidate.ownerUserId,
        method: outcome.candidate.method,
        tier: outcome.candidate.tier,
      }
    : null;

  const manifest: InvestigationManifest = {
    reportVersion: INVESTIGATION_MANIFEST_VERSION,
    probeId,
    investigationId: report.investigationId,
    investigatedAt: report.investigatedAt,
    mediaType,
    dnaAlgorithmVersion: outcome.dnaAlgorithmVersion || DNA_ALGORITHM_VERSION,
    acceptancePolicyVersion: outcome.acceptancePolicyVersion || ACCEPTANCE_POLICY_VERSION,
    analysisComplete,
    failureReason: analysisComplete ? null : outcome.decisionReason,

    probe: {
      probeId,
      filename: probeFilename,
      mimeType: probeMimeType,
      sizeBytes: probeSizeBytes,
      sha256: probeSha256 ?? report.currentFileHash,
    },
    candidates: candidatesFromReport(report, candidateLogs),
    acceptedCandidate: accepted,

    verdict: outcome.acceptanceVerdict,
    displayLabel: outcome.displayLabel,
    decisionReason: outcome.decisionReason,
    confidence: outcome.acceptanceConfidence,
    confidenceBreakdown: outcome.acceptanceScorecard,

    owner: {
      ownerName: report.owner.ownerName,
      ownerPinitId: report.owner.ownerPinitId,
      ownerUserId: outcome.candidate?.ownerUserId ?? null,
    },
    vault: {
      vaultId: report.owner.vaultId,
      originalFilename: report.owner.originalFilename,
      createdAt: report.owner.createdAt,
    },
    dna: {
      dnaRecordId: report.owner.dnaRecordId,
      algorithmVersion: outcome.dnaAlgorithmVersion || DNA_ALGORITHM_VERSION,
      sha256: report.identityRecoveryReport?.originalHash ?? report.currentFileHash,
      matchPercent: report.summary.dnaMatchPercent,
      classification: report.dnaComparison?.classification,
    },
    certificate: {
      certificateId: report.owner.certificateId,
      status: report.summary.certificateStatus,
      valid: report.summary.certificateStatus === 'VALID',
    },
    tamper: {
      primaryVector: report.tamperAnalysis?.primaryVector,
      overallTamperScore: report.tamperAnalysis?.overallTamperScore,
      flags: tamperFlags(report),
      description: report.tamperAnalysis?.description,
    },
    timeline: (report.timeline ?? []).map((t) => ({
      stage: t.stage,
      timestamp: t.timestamp,
      detail: t.detail,
    })),
    lifecycle: buildLifecycle(report),
    layers: layerSlots(report),
    evidence: {
      watermarkStatus: report.identityProof?.watermark?.status,
      identityVerification: report.identityProof?.identityVerification,
      digitalSignatureValid: report.identityProof?.digitalSignatureValid,
    },
    scores: {
      retrievalConfidence: report.summary.retrievalConfidence ?? outcome.retrievalConfidence,
      ownershipVerificationConfidence: report.summary.ownershipVerificationConfidence ?? 0,
      identityConfidence: report.summary.identityConfidence ?? 0,
      trustScore: report.summary.trustScore ?? 0,
      dnaMatchPercent: report.summary.dnaMatchPercent ?? 0,
    },
  };

  return Object.freeze(manifest) as InvestigationManifest;
}
