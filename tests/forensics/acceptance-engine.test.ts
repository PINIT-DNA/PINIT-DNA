/**
 * Acceptance Engine — frozen policy acceptance-policy-v1.0
 * docs/architecture/02_ACCEPTANCE_RULES.md
 */
import {
  computeAcceptanceScorecard,
  runAcceptanceEngine,
  passChannel,
  failChannel,
  skippedChannel,
} from '../../src/services/forensics/acceptance-engine.service';
import type { AcceptanceEvidence } from '../../src/types/acceptance.types';

function baseEvidence(over: Partial<AcceptanceEvidence> = {}): AcceptanceEvidence {
  return {
    analysisComplete: true,
    hasCandidate: true,
    vaultId: 'vault-1',
    dnaRecordId: 'dna-1',
    ownerUserId: 'owner-1',
    dna: passChannel(90, 'DNA_MATCH'),
    certificate: passChannel(100),
    vault: passChannel(100),
    owner: passChannel(100),
    timeline: passChannel(100),
    visual: passChannel(90),
    watermark: passChannel(100),
    metadata: passChannel(80),
    tamperDetected: false,
    ...over,
  };
}

describe('AcceptanceEngine', () => {
  it('returns INSUFFICIENT_EVIDENCE when analysis incomplete', () => {
    const d = runAcceptanceEngine(baseEvidence({
      analysisComplete: false,
      failureReason: 'Stage timed out after 120000ms',
      hasCandidate: false,
    }));
    expect(d.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(d.retrievalConfidence).toBe(0);
    expect(d.retainCandidate).toBe(false);
    expect(d.displayLabel).toMatch(/Insufficient Evidence/i);
  });

  it('returns NOT_PINIT when no candidate', () => {
    const d = runAcceptanceEngine(baseEvidence({
      hasCandidate: false,
      vault: failChannel(0),
      owner: failChannel(0),
      timeline: failChannel(0),
      dna: failChannel(0),
      visual: failChannel(0),
      certificate: failChannel(0),
      watermark: failChannel(0),
    }));
    expect(d.verdict).toBe('NOT_PINIT');
    expect(d.retrievalConfidence).toBe(0);
  });

  it('never verifies when DNA is DIFFERENT at 18% (94% retrieval bug)', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'FAIL', score: 18, classification: 'DIFFERENT' },
      visual: passChannel(94),
      certificate: failChannel(0),
      watermark: failChannel(0),
      tamperDetected: false,
    }));
    expect(d.verdict).not.toBe('VERIFIED_ORIGINAL');
    expect(d.verdict).not.toBe('VERIFIED_DERIVATIVE');
    expect(['NOT_PINIT', 'POSSIBLE_MATCH']).toContain(d.verdict);
    if (d.verdict === 'NOT_PINIT') {
      expect(d.retrievalConfidence).toBe(0);
    }
  });

  it('DNA DIFFERENT forces DNA scorecard contribution to 0', () => {
    const evidence = baseEvidence({
      dna: { state: 'PASS', score: 18, classification: 'DIFFERENT' },
    });
    const card = computeAcceptanceScorecard(evidence);
    expect(card.dna.contribution).toBe(0);
    expect(card.dna.state).toBe('FAIL');
  });

  it('VERIFIED_ORIGINAL when all gates pass and confidence > 95', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'PASS', score: 100, classification: 'DNA_MATCH' },
      certificate: passChannel(100),
      vault: passChannel(100),
      owner: passChannel(100),
      timeline: passChannel(100),
      visual: passChannel(100),
      watermark: passChannel(100),
      metadata: passChannel(100),
      tamperDetected: false,
    }));
    expect(d.verdict).toBe('VERIFIED_ORIGINAL');
    expect(d.confidence).toBeGreaterThan(95);
    expect(d.retainCandidate).toBe(true);
  });

  it('VERIFIED_DERIVATIVE when DNA partial, visual pass, tamper detected', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'PASS', score: 60, classification: 'SIMILAR' },
      certificate: failChannel(0),
      watermark: failChannel(0),
      visual: passChannel(70),
      owner: passChannel(80),
      timeline: passChannel(80),
      vault: passChannel(100),
      tamperDetected: true,
    }));
    expect(d.verdict).toBe('VERIFIED_DERIVATIVE');
    expect(d.displayLabel).toMatch(/Derivative/i);
  });

  it('POSSIBLE_MATCH when visual strong, DNA partial, no cert/watermark', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'PASS', score: 50, classification: 'SIMILAR' },
      visual: passChannel(85),
      certificate: skippedChannel(),
      watermark: failChannel(0),
      vault: passChannel(100),
      owner: passChannel(50),
      timeline: passChannel(50),
      tamperDetected: false,
    }));
    expect(d.verdict).toBe('POSSIBLE_MATCH');
    expect(d.displayLabel).toMatch(/Manual Review/i);
  });

  it('uses acceptance-policy-v1.0 and 15-layer-v1 versions', () => {
    const d = runAcceptanceEngine(baseEvidence());
    expect(d.acceptancePolicyVersion).toBe('acceptance-policy-v1.0');
    expect(d.dnaAlgorithmVersion).toBe('15-layer-v1');
  });
});
