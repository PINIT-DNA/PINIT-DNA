/**
 * Investigation Manifest — Phase 2
 * docs/architecture/10_INVESTIGATION_REPORT_SPEC.md
 */
import { buildInvestigationManifest } from '../../src/services/forensics/investigation-manifest.builder';
import { runAcceptanceEngine, failChannel, skippedChannel } from '../../src/services/forensics/acceptance-engine.service';
import type { InvestigationOutcome } from '../../src/services/forensics/investigation-decision-resolver.service';
import {
  mapAcceptanceToForensicVerdict,
  mapAcceptanceToReportState,
} from '../../src/services/forensics/investigation-decision-resolver.service';
import type { UnifiedInvestigationReport } from '../../src/types/unified-investigation.types';
import {
  ACCEPTANCE_POLICY_VERSION,
  DNA_ALGORITHM_VERSION,
  INVESTIGATION_MANIFEST_VERSION,
} from '../../src/types/investigation-manifest.types';

function outcomeFromDecision(): InvestigationOutcome {
  const decision = runAcceptanceEngine({
    analysisComplete: true,
    hasCandidate: false,
    dna: failChannel(0, 'MISSING'),
    certificate: skippedChannel(),
    vault: failChannel(0),
    owner: failChannel(0),
    timeline: failChannel(0),
    visual: failChannel(0),
    watermark: failChannel(0),
    metadata: skippedChannel(),
    tamperDetected: false,
  });
  return {
    state: mapAcceptanceToReportState(decision.verdict),
    candidate: null,
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
}

function minimalReport(): UnifiedInvestigationReport {
  return {
    success: false,
    investigationId: 'inv-test-1',
    investigatedAt: new Date().toISOString(),
    pipeline: [],
    summary: {
      ownershipConfidence: 0,
      dnaMatchPercent: 0,
      certificateStatus: 'UNKNOWN',
      identityStatus: 'NOT_FOUND',
      tamperSeverity: 'UNKNOWN',
      riskLevel: 'UNKNOWN',
      retrievalConfidence: 0,
      reportState: 'NO_SIGNATURE',
      acceptanceVerdict: 'NOT_PINIT',
    },
    owner: {},
    recipientAttribution: { fromShare: false, message: 'n/a' },
    layerAnalysis: [],
    tamperAnalysis: { primaryVector: 'NONE', overallTamperScore: 0, vectors: [] },
    timeline: [],
    accessIntelligence: [],
    leakIntelligence: { hasPublicLeak: false, entries: [], message: 'none' },
    identityProof: {
      digitalSignatureValid: false,
      identityVerification: 'NOT_FOUND',
      watermark: { status: 'NOT_EMBEDDED' },
    },
    currentFileHash: 'abc123',
  };
}

describe('InvestigationManifest', () => {
  it('produces immutable manifest with frozen versions', () => {
    const outcome = outcomeFromDecision();
    const manifest = buildInvestigationManifest({
      report: minimalReport(),
      outcome,
      probeFilename: 'probe.jpg',
      probeMimeType: 'image/jpeg',
      probeSizeBytes: 1024,
      probeSha256: 'abc123',
    });

    expect(manifest.reportVersion).toBe(INVESTIGATION_MANIFEST_VERSION);
    expect(manifest.acceptancePolicyVersion).toBe(ACCEPTANCE_POLICY_VERSION);
    expect(manifest.dnaAlgorithmVersion).toBe(DNA_ALGORITHM_VERSION);
    expect(manifest.verdict).toBe('NOT_PINIT');
    expect(manifest.confidence).toBe(0);
    expect(manifest.acceptedCandidate).toBeNull();
    expect(manifest.mediaType).toBe('image');
    expect(manifest.probe.filename).toBe('probe.jpg');
    expect(manifest.lifecycle.length).toBeGreaterThan(0);
    expect(manifest.confidenceBreakdown.dna.weight).toBe(30);
    expect(Object.isFrozen(manifest)).toBe(true);
  });

});

