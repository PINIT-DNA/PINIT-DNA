import {
  formatGpsPair,
  parseOriginalCaptureExif,
  readPinitProtect,
} from '../../src/services/intelligence/original-capture-exif';

describe('original capture EXIF vs PINIT protect', () => {
  it('reads camera EXIF and ignores pinitProtect GPS', () => {
    const parsed = parseOriginalCaptureExif({
      DateTimeOriginal: '2026:09:23 13:23:00',
      Make: 'Apple',
      Model: 'iPhone 15 Pro',
      FocalLength: 24,
      ISO: 100,
      FNumber: 1.8,
      latitude: 9.9312,
      longitude: 76.2673,
      pinitProtect: {
        gpsLatitude: 17.9171,
        gpsLongitude: 78.9751,
        placeName: 'Hyderabad, India',
        captureMethod: 'Upload',
      },
    });
    expect(parsed.capturedAt).toContain('2026-09-23');
    expect(parsed.cameraMake).toBe('Apple');
    expect(parsed.cameraModel).toBe('iPhone 15 Pro');
    expect(parsed.gpsLatitude).toBeCloseTo(9.9312);
    expect(parsed.iso).toBe('100');
    expect(formatGpsPair(parsed.gpsLatitude, parsed.gpsLongitude)).toContain('9.93120');
    expect(readPinitProtect({
      pinitProtect: { placeName: 'Hyderabad, India', captureMethod: 'Upload' },
    })?.placeName).toBe('Hyderabad, India');
  });

  it('does not treat protect-session fields as original capture', () => {
    const parsed = parseOriginalCaptureExif({
      pinitProtect: {
        gpsLatitude: 17.9171,
        gpsLongitude: 78.9751,
        captureMethod: 'Upload',
        timezone: 'Asia/Calcutta',
      },
    });
    expect(parsed.capturedAt).toBeNull();
    expect(parsed.gpsLatitude).toBeNull();
    expect(parsed.cameraModel).toBeNull();
    expect(parsed.metadataPreserved).toBe(false);
  });
});
