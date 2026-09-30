import {
  classifyAmbientBrightness,
  meanLuminance,
  minMaxContrastStretch,
} from '../../client/src/lib/face-image-processing';
import { sanitizeLoginLighting } from '../../src/services/auth/biometric-audit.service';

describe('face lighting analysis', () => {
  test('classifies dark / optimal / bright', () => {
    expect(classifyAmbientBrightness(10)).toBe('TOO_DARK');
    expect(classifyAmbientBrightness(39.9)).toBe('TOO_DARK');
    expect(classifyAmbientBrightness(40)).toBe('OPTIMAL');
    expect(classifyAmbientBrightness(180)).toBe('OPTIMAL');
    expect(classifyAmbientBrightness(220)).toBe('OPTIMAL');
    expect(classifyAmbientBrightness(221)).toBe('TOO_BRIGHT');
  });

  test('mean luminance uses Rec. 709 weights', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    const expected = 0.2126 * 10 + 0.7152 * 20 + 0.0722 * 30;
    expect(meanLuminance(data)).toBeCloseTo(expected, 5);
  });

  test('min-max stretch expands a compressed range', () => {
    const data = new Uint8ClampedArray([80, 80, 80, 255, 120, 120, 120, 255]);
    minMaxContrastStretch(data);
    expect(data[0]).toBeLessThan(data[4]!);
    expect(data[0]).toBe(0);
    expect(data[4]).toBe(255);
    expect(data[3]).toBe(255);
    expect(data[7]).toBe(255);
  });

  test('stretch is a no-op when the frame is uniform', () => {
    const data = new Uint8ClampedArray([90, 90, 90, 255, 90, 90, 90, 255]);
    minMaxContrastStretch(data);
    expect(Array.from(data)).toEqual([90, 90, 90, 255, 90, 90, 90, 255]);
  });
});

describe('sanitizeLoginLighting', () => {
  test('accepts only known statuses and clamps brightness', () => {
    expect(sanitizeLoginLighting({ lightingStatus: 'TOO_DARK', ambientBrightness: 12.4 })).toEqual({
      lightingStatus: 'TOO_DARK',
      ambientBrightness: 12,
    });
    expect(sanitizeLoginLighting({ lightingStatus: 'evil', ambientBrightness: 900 })).toEqual({
      lightingStatus: null,
      ambientBrightness: 255,
    });
  });
});
