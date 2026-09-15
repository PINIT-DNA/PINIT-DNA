import {
  classifyRegionState,
  presentationColor,
  stampRegionForensicFields,
  FORENSIC_RESULT_STATES,
} from '../../src/services/forensics/forensic-result-state';
import { splitProbeComposition } from '../../src/services/forensics/investigation-composition.service';
import type { PixelSourceRegionReport } from '../../src/types/investigation-composition.types';

function region(over: Partial<PixelSourceRegionReport> = {}): PixelSourceRegionReport {
  return {
    type: 'VAULT_MATCH',
    uploadedBounds: { x: 340, y: 520, width: 270, height: 180 },
    vaultBounds: { x: 0, y: 0, width: 270, height: 180 },
    confidence: 0.987,
    coveragePercent: 4.72,
    ransacInliers: 42,
    matchedFeatures: 80,
    pixelSimilarity: 0.91,
    evidenceRadius: 16,
    ...over,
  };
}

describe('forensic result states (internal ≠ overlay color)', () => {
  it('exposes five explicit states', () => {
    expect([...FORENSIC_RESULT_STATES]).toEqual([
      'VERIFIED_VAULT_ORIGIN',
      'LIKELY_VAULT_ORIGIN',
      'NON_VAULT_MODIFIED',
      'AI_SUSPECTED',
      'UNKNOWN',
    ]);
  });

  it('MATRIX exact original + HMAC → VERIFIED_VAULT_ORIGIN / GREEN', () => {
    const state = classifyRegionState({
      spatialVerified: true,
      ransacInliers: 40,
      matchedFeatures: 90,
      confidence: 0.99,
      hmacVerified: true,
      mappedMismatch: false,
      aiDetectorPositive: false,
    });
    expect(state).toBe('VERIFIED_VAULT_ORIGIN');
    expect(presentationColor(state)).toBe('GREEN');
  });

  it('MATRIX crop/copy-paste with spatial but no HMAC → LIKELY_VAULT_ORIGIN / GREEN', () => {
    const state = classifyRegionState({
      spatialVerified: true,
      ransacInliers: 22,
      matchedFeatures: 40,
      confidence: 0.82,
      hmacVerified: false,
      mappedMismatch: false,
      aiDetectorPositive: false,
    });
    expect(state).toBe('LIKELY_VAULT_ORIGIN');
    expect(presentationColor(state)).toBe('GREEN');
  });

  it('MATRIX JPEG/photometric: spatial holds, HMAC optional → still GREEN internally LIKELY', () => {
    const state = classifyRegionState({
      spatialVerified: true,
      ransacInliers: 18,
      matchedFeatures: 30,
      confidence: 0.7,
      hmacVerified: false,
      mappedMismatch: false,
      aiDetectorPositive: false,
    });
    expect(state).toBe('LIKELY_VAULT_ORIGIN');
    expect(presentationColor(state)).toBe('GREEN');
  });

  it('MATRIX mapped mismatch → NON_VAULT_MODIFIED / ORANGE, not AI', () => {
    const state = classifyRegionState({
      spatialVerified: false,
      ransacInliers: 0,
      matchedFeatures: 0,
      confidence: 0.2,
      hmacVerified: false,
      mappedMismatch: true,
      aiDetectorPositive: false,
    });
    expect(state).toBe('NON_VAULT_MODIFIED');
    expect(presentationColor(state)).toBe('ORANGE');
    expect(state).not.toBe('AI_SUSPECTED');
  });

  it('MATRIX unrelated camera/stock photo → UNKNOWN / GREY, not AI_SUSPECTED', () => {
    const state = classifyRegionState({
      spatialVerified: false,
      ransacInliers: 2,
      matchedFeatures: 3,
      confidence: 0.1,
      hmacVerified: false,
      mappedMismatch: false,
      aiDetectorPositive: false,
    });
    expect(state).toBe('UNKNOWN');
    expect(presentationColor(state)).toBe('GREY');
  });

  it('MATRIX independent AI detector only → AI_SUSPECTED / ORANGE', () => {
    const state = classifyRegionState({
      spatialVerified: false,
      ransacInliers: 0,
      matchedFeatures: 0,
      confidence: 0,
      hmacVerified: false,
      mappedMismatch: false,
      aiDetectorPositive: true,
    });
    expect(state).toBe('AI_SUSPECTED');
    expect(presentationColor(state)).toBe('ORANGE');
  });

  it('MATRIX isolated / weak matches → UNKNOWN (do not fabricate certainty)', () => {
    const state = classifyRegionState({
      spatialVerified: true,
      ransacInliers: 3,
      matchedFeatures: 4,
      confidence: 0.3,
      hmacVerified: false,
      mappedMismatch: false,
      aiDetectorPositive: false,
    });
    expect(state).toBe('UNKNOWN');
    expect(presentationColor(state)).toBe('GREY');
  });

  it('non-Vault is not a synonym for AI-generated', () => {
    const nonVault = classifyRegionState({
      spatialVerified: false,
      ransacInliers: 0,
      matchedFeatures: 0,
      confidence: 0,
      hmacVerified: false,
      mappedMismatch: true,
      aiDetectorPositive: false,
    });
    const ai = classifyRegionState({
      spatialVerified: false,
      ransacInliers: 0,
      matchedFeatures: 0,
      confidence: 0,
      hmacVerified: false,
      mappedMismatch: false,
      aiDetectorPositive: true,
    });
    expect(nonVault).toBe('NON_VAULT_MODIFIED');
    expect(ai).toBe('AI_SUSPECTED');
    expect(nonVault).not.toBe(ai);
    expect(presentationColor(nonVault)).toBe(presentationColor(ai));
  });

  it('AI detector score is not used as Vault coverage', () => {
    const parts = splitProbeComposition(4.7, 76);
    expect(parts.protectedFromAssetPercent).toBe(4.7);
    expect(parts.aiGeneratedPercent).toBe(0);
    expect(parts.otherPercent).toBe(95.3);
    expect(parts.aiSuspectedPercent).toBe(76);
    expect(parts.aiSuspectedPercent).not.toBe(parts.protectedFromAssetPercent);
  });

  it('stamps region evidence for the expandable proof view', () => {
    const stamped = stampRegionForensicFields(region({
      sourceVaultId: 'vault-oip',
    }), {
      hmacVerified: true,
      provenanceDetected: true,
    });
    expect(stamped.forensicState).toBe('VERIFIED_VAULT_ORIGIN');
    expect(stamped.presentationColor).toBe('GREEN');
    expect(stamped.provenanceStatus).toBe('DETECTED');
    expect(stamped.spatialCorrespondence).toBe('VERIFIED');
    expect(stamped.dnaVerification).toBe('VERIFIED');
    expect(stamped.vaultBounds).toEqual({ x: 0, y: 0, width: 270, height: 180 });
    expect(stamped.uploadedBounds).toEqual({ x: 340, y: 520, width: 270, height: 180 });
  });
});
