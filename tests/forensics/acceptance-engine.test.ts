/**
 * Acceptance Engine — acceptance-policy-v1.2 / investigation-match-policy
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
    expect(d.displayLabel).toMatch(/Incomplete|Insufficient/i);
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

  it('Asset Not Found when DNA DIFFERENT without local-patch (lookalike guard)', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'FAIL', score: 18, classification: 'DIFFERENT' },
      visual: passChannel(94),
      certificate: failChannel(0),
      watermark: failChannel(0),
      tamperDetected: false,
    }));
    expect(d.verdict).toBe('NOT_PINIT');
    expect(d.retainCandidate).toBe(false);
  });

  it('Asset Not Found when support <50% and no local-patch', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'FAIL', score: 35, classification: 'SIMILAR' },
      visual: passChannel(40),
      certificate: failChannel(0),
      watermark: failChannel(0),
      owner: failChannel(0),
      timeline: failChannel(0),
      vault: passChannel(100),
      tamperDetected: false,
    }));
    expect(d.verdict).toBe('NOT_PINIT');
  });

  it('Asset Not Found for visual-only mid-band with DIFFERENT DNA (no patch)', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'FAIL', score: 28, classification: 'DIFFERENT' },
      visual: passChannel(61),
      certificate: failChannel(0),
      watermark: failChannel(0),
      owner: failChannel(0),
      timeline: failChannel(0),
      vault: passChannel(100),
      tamperDetected: false,
    }));
    expect(d.verdict).toBe('NOT_PINIT');
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
      dna: { state: 'PASS', score: 90, classification: 'SIMILAR' },
      certificate: failChannel(0),
      watermark: failChannel(0),
      visual: passChannel(90),
      owner: passChannel(100),
      timeline: passChannel(100),
      vault: passChannel(100),
      tamperDetected: true,
    }));
    expect(d.verdict).toBe('VERIFIED_DERIVATIVE');
    expect(d.displayLabel).toMatch(/Derivative/i);
    expect(d.confidence).toBeGreaterThanOrEqual(45);
  });

  it('does not verify derivative on weak 56% DNA with low confidence (unrelated photos)', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'PASS', score: 56, classification: 'SIMILAR' },
      certificate: failChannel(0),
      watermark: failChannel(0),
      visual: passChannel(42),
      owner: passChannel(50),
      timeline: passChannel(50),
      vault: passChannel(100),
      tamperDetected: true,
    }));
    expect(d.verdict).not.toBe('VERIFIED_ORIGINAL');
    expect(d.verdict).not.toBe('VERIFIED_DERIVATIVE');
    expect(d.retainCandidate).toBe(false);
    expect(['NOT_PINIT', 'POSSIBLE_MATCH']).toContain(d.verdict);
  });

  it('does not verify derivative on 61% DNA with weak visual (unrelated logo vs photo)', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'PASS', score: 61, classification: 'SIMILAR' },
      certificate: failChannel(0),
      watermark: failChannel(0),
      visual: passChannel(48),
      owner: passChannel(50),
      timeline: passChannel(50),
      vault: passChannel(100),
      tamperDetected: true,
    }));
    expect(d.verdict).not.toBe('VERIFIED_ORIGINAL');
    expect(d.verdict).not.toBe('VERIFIED_DERIVATIVE');
    expect(d.retainCandidate).toBe(false);
    expect(['NOT_PINIT', 'POSSIBLE_MATCH']).toContain(d.verdict);
  });

  it('does not verify derivative on 70% DNA with different subjects (weak visual)', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'PASS', score: 70, classification: 'SIMILAR' },
      certificate: failChannel(0),
      watermark: failChannel(0),
      visual: passChannel(52),
      owner: passChannel(50),
      timeline: passChannel(50),
      vault: passChannel(100),
      tamperDetected: true,
    }));
    expect(d.verdict).not.toBe('VERIFIED_ORIGINAL');
    expect(d.verdict).not.toBe('VERIFIED_DERIVATIVE');
    expect(d.retainCandidate).toBe(false);
  });

  it('VERIFIED_DERIVATIVE for local-patch crop when DNA fragment + visual clear gates', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'PASS', score: 72, detail: 'local_patch_12', classification: 'SIMILAR' },
      certificate: skippedChannel('No certificate'),
      watermark: failChannel(0),
      visual: passChannel(78),
      owner: failChannel(0, 'not bound'),
      timeline: passChannel(100),
      vault: passChannel(100),
      tamperDetected: true,
    }));
    expect(d.verdict).toBe('VERIFIED_DERIVATIVE');
    expect(d.retainCandidate).toBe(true);
    expect(d.displayLabel).toMatch(/Derivative/i);
  });

  it('POSSIBLE_MATCH for local-patch fragment at ≥55% without full verify', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'PASS', score: 58, detail: 'local_patch_8', classification: 'SIMILAR' },
      visual: passChannel(60),
      certificate: failChannel(0),
      watermark: failChannel(0),
      owner: failChannel(0),
      timeline: passChannel(40),
      vault: passChannel(100),
      tamperDetected: true,
    }));
    expect(['POSSIBLE_MATCH', 'VERIFIED_DERIVATIVE']).toContain(d.verdict);
    expect(d.retainCandidate).toBe(d.verdict === 'VERIFIED_DERIVATIVE');
  });

  it('POSSIBLE_MATCH when visual strong, DNA partial, no cert/watermark', () => {
    const d = runAcceptanceEngine(baseEvidence({
      dna: { state: 'PASS', score: 55, classification: 'SIMILAR' },
      visual: passChannel(85),
      certificate: skippedChannel(),
      watermark: failChannel(0),
      vault: passChannel(100),
      owner: passChannel(50),
      timeline: passChannel(50),
      tamperDetected: false,
    }));
    expect(d.verdict).toBe('POSSIBLE_MATCH');
    expect(d.displayLabel).toMatch(/Protected original identified/i);
  });

  it('uses acceptance-policy-v1.2 and 15-layer-v1 versions', () => {
    const d = runAcceptanceEngine(baseEvidence());
    expect(d.acceptancePolicyVersion).toBe('acceptance-policy-v1.2');
    expect(d.dnaAlgorithmVersion).toBe('15-layer-v1');
  });
});
