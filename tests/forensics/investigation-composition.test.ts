import {
  buildCompositionLabels,
  protectedAreaFromSignals,
  regionAreaPercent,
  round1,
  splitProbeComposition,
} from '../../src/services/forensics/investigation-composition.service';
import type { FragmentReuseFinding } from '../../src/types/unified-investigation.types';

function finding(over: Partial<FragmentReuseFinding> = {}): FragmentReuseFinding {
  return {
    vaultId: 'v1',
    dnaRecordId: 'd1',
    ownerFilename: 'original.png',
    patchMatchCount: 14,
    confidence: 82,
    probeRegion: { xPercent: 10, yPercent: 20, widthPercent: 30, heightPercent: 40 },
    vaultRegion: { xPercent: 5, yPercent: 5, widthPercent: 25, heightPercent: 36 },
    probeCoveragePercent: 12,
    vaultCoveragePercent: 9,
    ...over,
  };
}

describe('investigation composition', () => {
  it('splits probe so protected pixels are never counted as AI', () => {
    const parts = splitProbeComposition(12, 85);
    expect(parts.protectedFromAssetPercent).toBe(12);
    expect(parts.aiGeneratedPercent).toBe(74.8);
    expect(parts.otherPercent).toBe(13.2);
    expect(round1(
      parts.protectedFromAssetPercent + parts.aiGeneratedPercent + parts.otherPercent,
    )).toBe(100);
  });

  it('puts unmatched remainder in Other when AI model is unavailable', () => {
    const parts = splitProbeComposition(12, null);
    expect(parts).toEqual({
      protectedFromAssetPercent: 12,
      aiGeneratedPercent: 0,
      otherPercent: 88,
    });
  });

  it('uses fragment bbox coverage for a crop pasted into an AI image', () => {
    const spatial = protectedAreaFromSignals({
      fragmentFindings: [finding()],
      localDnaHit: { matchRatio: 0.8, coverageRatio: 0.8, patchMatchCount: 200 },
    });
    expect(spatial.protectedAreaPercent).toBe(12);
    expect(spatial.originalUsedPercent).toBe(9);
  });

  it('falls back to local-DNA match/coverage ratios for crop-scale patch hits', () => {
    const spatial = protectedAreaFromSignals({
      fragmentFindings: [],
      localDnaHit: { matchRatio: 0.15, coverageRatio: 0.08, patchMatchCount: 22 },
    });
    expect(spatial.protectedAreaPercent).toBe(15);
    expect(spatial.originalUsedPercent).toBe(8);
  });

  it('treats unmatched collage pixels as AI, not as classifier-score × remainder', () => {
    const parts = splitProbeComposition(18, 23.7, { collageRemainderIsAi: true });
    expect(parts).toEqual({
      protectedFromAssetPercent: 18,
      aiGeneratedPercent: 82,
      otherPercent: 0,
    });
  });

  it('prefers a localized crop bbox over a collapsed 0.3% fragment island', () => {
    const spatial = protectedAreaFromSignals({
      fragmentFindings: [finding({
        probeCoveragePercent: 0.3,
        probeRegion: { xPercent: 12, yPercent: 70, widthPercent: 3, heightPercent: 10 },
        vaultCoveragePercent: 83.6,
      })],
      cropDetection: {
        probeCoveragePercent: 22.4,
        vaultCoveragePercent: 80,
        probeRegion: { xPercent: 4, yPercent: 8, widthPercent: 28, heightPercent: 80 },
        vaultRegion: { xPercent: 8, yPercent: 5, widthPercent: 85, heightPercent: 90 },
      },
    });
    expect(spatial.protectedAreaPercent).toBe(22.4);
    expect(spatial.probeRegion?.widthPercent).toBe(28);
  });

  it('ignores a collapsed fragment bbox so it is not shown as protected coverage', () => {
    const spatial = protectedAreaFromSignals({
      fragmentFindings: [finding({
        probeCoveragePercent: 0.3,
        probeRegion: { xPercent: 12, yPercent: 70, widthPercent: 3, heightPercent: 10 },
        vaultCoveragePercent: 83.6,
      })],
    });
    expect(spatial.protectedAreaPercent).toBe(0);
    expect(spatial.originalUsedPercent).toBe(83.6);
  });

  it('uses crop bbox when DNA fragments are missing but the paste is localized', () => {
    const spatial = protectedAreaFromSignals({
      fragmentFindings: [],
      cropDetection: {
        probeCoveragePercent: 14.2,
        vaultCoveragePercent: 22,
        probeRegion: { xPercent: 2, yPercent: 8, widthPercent: 28, heightPercent: 50 },
        vaultRegion: { xPercent: 10, yPercent: 5, widthPercent: 40, heightPercent: 55 },
      },
    });
    expect(spatial.protectedAreaPercent).toBe(14.2);
    expect(spatial.probeRegion?.widthPercent).toBe(28);
  });

  it('does not treat a 56% whole-image lookalike as protected-file coverage', () => {
    const spatial = protectedAreaFromSignals({
      fragmentFindings: [],
      localDnaHit: { matchRatio: 0.56, coverageRatio: 0.56, patchMatchCount: 80 },
    });
    expect(spatial.protectedAreaPercent).toBe(0);
  });

  it('computes region area from width × height percents', () => {
    expect(regionAreaPercent({ widthPercent: 20, heightPercent: 15 })).toBe(3);
  });

  it('exposes the three colored labels the investigation UI renders', () => {
    const labels = buildCompositionLabels({
      protectedFromAssetPercent: 12,
      aiGeneratedPercent: 81,
      otherPercent: 7,
    });
    expect(labels.map((l) => l.key)).toEqual(['protected', 'ai', 'other']);
    expect(labels[0]?.color).toBe('#10B981');
    expect(labels[1]?.color).toBe('#F59E0B');
    expect(labels[2]?.color).toBe('#94A3B8');
  });

  it('uses block-level vault overlay percents when present', async () => {
    const { buildInvestigationComposition } = await import(
      '../../src/services/forensics/investigation-composition.service'
    );
    const result = await buildInvestigationComposition({
      fragmentFindings: [],
      scan: {
        available: true,
        overallConfidence: 80,
        candidates: [],
        blockComposition: {
          protectedFromAssetPercent: 72,
          aiGeneratedPercent: 18,
          otherPercent: 10,
          overlayPngBase64: 'abc',
          grid: { rows: 2, cols: 2, labels: 'GAAA' },
          probeRegion: { xPercent: 8, yPercent: 4, widthPercent: 22, heightPercent: 72 },
        },
      },
    });
    expect(result.protectedFromAssetPercent).toBe(72);
    expect(result.aiGeneratedPercent).toBe(18);
    expect(result.otherPercent).toBe(10);
    expect(result.overlayPngBase64).toBe('abc');
    expect(result.blockGrid?.labels).toBe('GAAA');
    expect(result.probeRegion?.heightPercent).toBe(72);
  });
});
