import { describe, expect, test } from '@jest/globals';
import {
  compactFromGray,
  cosineSimilarity,
  fingerprintIdFromCompact,
  qualityStatusFromStd,
  residualStd,
  toPublicCameraForensics,
} from '../../src/services/forensics/prnu-camera.service';
import { PRNU_CAMERA_DISCLAIMER } from '../../src/types/camera-forensics.types';

describe('PRNU camera-sensor sidecar', () => {
  test('identical residuals correlate at 1', () => {
    const a = new Float32Array([1, 2, 3, 4]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  test('orthogonal residuals correlate near 0', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0, 1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  test('flat field is insufficient quality, not a different camera', () => {
    const gray = new Uint8Array(256 * 256).fill(128);
    const { qualityStatus } = compactFromGray(gray, 256, 256);
    expect(qualityStatus).toBe('INSUFFICIENT');
    expect(qualityStatusFromStd(residualStd(new Float32Array(100)))).toBe('INSUFFICIENT');
  });

  test('public payload never includes residual bytes', () => {
    const compact = new Int8Array([1, -2, 3, -4, 5, -6, 7, -8]);
    const pub = toPublicCameraForensics({
      version: 1,
      fingerprintId: fingerprintIdFromCompact(compact),
      correlation: 0.41,
      quality: 6,
      qualityStatus: 'OK',
      residualB64: Buffer.from(compact).toString('base64'),
      dim: 8,
      sameCameraCandidates: [],
      enrolledNewProfile: false,
      disclaimer: PRNU_CAMERA_DISCLAIMER,
      processedAt: '2026-09-28T00:00:00.000Z',
    });
    expect(pub).not.toBeNull();
    expect(pub && 'residualB64' in pub).toBe(false);
    expect(pub?.residualStored).toBe(true);
    expect(pub?.disclaimer).toContain('does not identify a PINIT user');
    expect(pub?.fingerprintId?.startsWith('CAM-')).toBe(true);
  });
});
