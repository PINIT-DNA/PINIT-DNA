/**
 * DNA Layer Standardization — Phase 3
 * docs/architecture/03_DNA_SPECIFICATION.md
 */
import { standardizeDnaLayers } from '../../src/services/forensics/dna-layer-standardization.service';
import { buildInvestigationManifest } from '../../src/services/forensics/investigation-manifest.builder';
import {
  runAcceptanceEngine,
  failChannel,
  skippedChannel,
} from '../../src/services/forensics/acceptance-engine.service';
import {
  mapAcceptanceToForensicVerdict,
  mapAcceptanceToReportState,
  type InvestigationOutcome,
} from '../../src/services/forensics/investigation-decision-resolver.service';
import type { UnifiedInvestigationReport } from '../../src/types/unified-investigation.types';
import {
  DNA_ALGORITHM_VERSION,
  DNA_LAYER_COUNT,
  DNA_LAYER_REGISTRY_V1,
} from '../../src/types/dna-layer.types';

function notPinitOutcome(): InvestigationOutcome {
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
    investigationId: 'inv-dna-1',
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
    currentFileHash: 'deadbeef',
  };
}

describe('DNA Layer Standardization', () => {
  it('always returns exactly 15 layers with required fields', () => {
    const outcome = notPinitOutcome();
    const bundle = standardizeDnaLayers({
      report: minimalReport(),
      outcome,
      mediaType: 'image',
    });

    expect(bundle.dnaAlgorithmVersion).toBe(DNA_ALGORITHM_VERSION);
    expect(bundle.layerCount).toBe(DNA_LAYER_COUNT);
    expect(bundle.layers).toHaveLength(15);

    for (let i = 0; i < 15; i++) {
      const layer = bundle.layers[i]!;
      const reg = DNA_LAYER_REGISTRY_V1[i]!;
      expect(layer.id).toBe(reg.id);
      expect(layer.name).toBe(reg.name);
      expect(['PASS', 'FAIL', 'SKIPPED']).toContain(layer.status);
      expect(typeof layer.score).toBe('number');
      expect(layer.reason).toBeTruthy();
      expect(layer.evidence).toBeDefined();
      expect(typeof layer.duration).toBe('number');
      expect(layer.status).not.toBeUndefined();
      expect(layer.status).not.toBeNull();
    }
  });

  it('marks PDF-inapplicable visual features as SKIPPED', () => {
    const bundle = standardizeDnaLayers({
      report: minimalReport(),
      outcome: notPinitOutcome(),
      mediaType: 'pdf',
    });
    const visual = bundle.layers.find((l) => l.id === 6)!;
    expect(visual.status).toBe('SKIPPED');
    expect(visual.reason).toMatch(/PDF|document/i);
  });

  it('populates manifest.layers with standardized slots', () => {
    const outcome = notPinitOutcome();
    const manifest = buildInvestigationManifest({
      report: minimalReport(),
      outcome,
      probeFilename: 'probe.jpg',
      probeMimeType: 'image/jpeg',
      probeSizeBytes: 100,
      probeSha256: 'deadbeef',
    });

    expect(manifest.dnaAlgorithmVersion).toBe(DNA_ALGORITHM_VERSION);
    expect(manifest.layers).toHaveLength(15);
    for (const l of manifest.layers) {
      expect(l.id).toBeGreaterThanOrEqual(1);
      expect(l.id).toBeLessThanOrEqual(15);
      expect(['PASS', 'FAIL', 'SKIPPED']).toContain(l.status);
      expect(['PASS', 'FAIL', 'SKIPPED']).toContain(l.state);
      expect(typeof l.score).toBe('number');
      expect(l.reason.length).toBeGreaterThan(0);
      expect(l.evidence).toBeDefined();
    }
    expect(manifest.layers[14]!.name).toBe('Final Verdict');
  });

  it('layer 15 reflects Acceptance Engine verdict', () => {
    const outcome = notPinitOutcome();
    const bundle = standardizeDnaLayers({
      report: minimalReport(),
      outcome,
      mediaType: 'image',
    });
    const finalLayer = bundle.layers[14]!;
    expect(finalLayer.id).toBe(15);
    expect(finalLayer.status).toBe('FAIL');
    expect(finalLayer.evidence.verdict).toBe('NOT_PINIT');
  });
});
