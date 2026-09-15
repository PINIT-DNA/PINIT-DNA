import {
  buildCompositionLabels,
  buildHowWeKnow,
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
    expect(parts.aiGeneratedPercent).toBe(0);
    expect(parts.otherPercent).toBe(88);
    expect(parts.aiSuspectedPercent).toBe(85);
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
      aiSuspectedPercent: null,
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

  it('keeps unmatched collage pixels GREY unless a separate AI detector is used', () => {
    const parts = splitProbeComposition(18, 23.7, { collageRemainderIsUnknown: true });
    expect(parts).toEqual({
      protectedFromAssetPercent: 18,
      aiGeneratedPercent: 0,
      otherPercent: 82,
      aiSuspectedPercent: 23.7,
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
    expect(labels[1]?.label).toBe('Non-Vault');
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

  it('does not re-run Python scanProbe when pixelSource is already on the scan', async () => {
    const scanProbe = jest.fn();
    jest.resetModules();
    jest.doMock('../../src/services/forensics/forensic-scanner.service', () => ({
      forensicScannerService: { scanProbe },
    }));
    const { buildInvestigationComposition } = await import(
      '../../src/services/forensics/investigation-composition.service'
    );
    const result = await buildInvestigationComposition({
      probeBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      vaultBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      probeMimeType: 'image/jpeg',
      fragmentFindings: [],
      scan: {
        available: true,
        overallConfidence: 90,
        candidates: [],
        pixelSource: {
          width: 10,
          height: 10,
          vaultWidth: 10,
          vaultHeight: 10,
          originalPixels: 80,
          aiSuspectedPixels: 10,
          unknownPixels: 10,
          totalPixels: 100,
          protectedFromAssetPercent: 80,
          aiGeneratedPercent: 10,
          otherPercent: 10,
          originalUsedPercent: 80,
          regions: [],
          method: 'test',
        },
      },
    });
    expect(scanProbe).not.toHaveBeenCalled();
    expect(result.protectedFromAssetPercent).toBe(80);
  });

  it('explains Vault origin without claiming a Vault ID lives in the pixel', () => {
    const know = buildHowWeKnow({
      vaultId: 'vault-abc',
      vaultFilename: 'OIP (2).jpg',
      dnaRecordId: 'dna-1',
      certificateId: 'cert-9',
      protectedPercent: 4.72,
      regionCount: 1,
    });
    expect(know.independentPixelContainsVaultId).toBe(false);
    expect(know.narrative).toContain('Vault ID vault-abc');
    expect(know.narrative).toContain('does not contain a Vault ID');
  });
});
