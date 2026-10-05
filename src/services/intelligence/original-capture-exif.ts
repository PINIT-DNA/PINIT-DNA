/**
 * Original camera/file EXIF — never mix with PINIT protect-session fields.
 */
export type OriginalCaptureExif = {
  capturedAt: string | null;
  timezone: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAltitude: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  focalLength: string | null;
  exposureTime: string | null;
  aperture: string | null;
  iso: string | null;
  flash: string | null;
  orientation: string | null;
  software: string | null;
  width: number | null;
  height: number | null;
  whiteBalance: string | null;
  meteringMode: string | null;
  exposureProgram: string | null;
  colorSpace: string | null;
  sceneCaptureType: string | null;
  lightSource: string | null;
  metadataPreserved: boolean;
};

export type PinitProtectSnapshot = {
  timezone?: string | null;
  captureMethod?: string | null;
  width?: number | null;
  height?: number | null;
  gpsAccuracy?: number | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  placeName?: string | null;
  fullAddress?: string | null;
  village?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  recordedAt?: string | null;
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function pickString(data: Record<string, unknown> | null, keys: string[]): string | null {
  if (!data) return null;
  for (const key of keys) {
    const val = data[key];
    if (typeof val === 'string' && val.trim() && !/^pinit/i.test(val.trim())) return val.trim();
    if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  }
  return null;
}

function pickNumber(data: Record<string, unknown> | null, keys: string[]): number | null {
  if (!data) return null;
  for (const key of keys) {
    const val = data[key];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() && Number.isFinite(Number(val))) return Number(val);
  }
  return null;
}

function pickDateIso(data: Record<string, unknown> | null, keys: string[]): string | null {
  if (!data) return null;
  for (const key of keys) {
    const val = data[key];
    if (val instanceof Date && !Number.isNaN(val.getTime())) return val.toISOString();
    if (typeof val === 'string' && val.trim()) {
      const normalized = val.includes('T') ? val : val.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return null;
}

function formatExposure(raw: string | null): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n < 1) return `1/${Math.round(1 / n)}s`;
  if (Number.isFinite(n) && n >= 1) return `${n}s`;
  return raw;
}

function formatMm(raw: string | null): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return `${Math.round(n * 10) / 10}mm`;
  return /mm/i.test(raw) ? raw : `${raw}mm`;
}

export function readPinitProtect(exifRaw: unknown): PinitProtectSnapshot | null {
  const data = asRecord(exifRaw);
  const row = asRecord(data?.pinitProtect);
  if (!row) return null;
  return {
    timezone: typeof row.timezone === 'string' ? row.timezone : null,
    captureMethod: typeof row.captureMethod === 'string' ? row.captureMethod : null,
    width: typeof row.width === 'number' ? row.width : null,
    height: typeof row.height === 'number' ? row.height : null,
    gpsAccuracy: typeof row.gpsAccuracy === 'number' ? row.gpsAccuracy : null,
    gpsLatitude: typeof row.gpsLatitude === 'number' ? row.gpsLatitude : null,
    gpsLongitude: typeof row.gpsLongitude === 'number' ? row.gpsLongitude : null,
    placeName: typeof row.placeName === 'string' ? row.placeName : null,
    fullAddress: typeof row.fullAddress === 'string' ? row.fullAddress : null,
    village: typeof row.village === 'string' ? row.village : null,
    city: typeof row.city === 'string' ? row.city : null,
    state: typeof row.state === 'string' ? row.state : null,
    country: typeof row.country === 'string' ? row.country : null,
    recordedAt: typeof row.recordedAt === 'string' ? row.recordedAt : null,
  };
}

export function parseOriginalCaptureExif(exifRaw: unknown): OriginalCaptureExif {
  const data = asRecord(exifRaw);
  const original = data ? { ...data } : null;
  if (original) delete original.pinitProtect;
  const empty: OriginalCaptureExif = {
    capturedAt: null,
    timezone: null,
    gpsLatitude: null,
    gpsLongitude: null,
    gpsAltitude: null,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    focalLength: null,
    exposureTime: null,
    aperture: null,
    iso: null,
    flash: null,
    orientation: null,
    software: null,
    width: null,
    height: null,
    whiteBalance: null,
    meteringMode: null,
    exposureProgram: null,
    colorSpace: null,
    sceneCaptureType: null,
    lightSource: null,
    metadataPreserved: false,
  };
  if (!original) return empty;

  const gpsLatitude = pickNumber(original, ['latitude', 'GPSLatitude', 'gpsLatitude']);
  const gpsLongitude = pickNumber(original, ['longitude', 'GPSLongitude', 'gpsLongitude']);
  const capturedAt = pickDateIso(original, ['DateTimeOriginal', 'dateTimeOriginal', 'CreateDate', 'DateTime']);
  const cameraMake = pickString(original, ['Make', 'make']);
  const cameraModel = pickString(original, ['Model', 'model']);
  const software = pickString(original, ['Software', 'software', 'ProcessingSoftware']);
  const hasAny = Boolean(
    capturedAt || cameraMake || cameraModel || gpsLatitude != null || pickString(original, ['LensModel', 'ISO', 'FNumber']),
  );

  return {
    capturedAt,
    timezone: pickString(original, ['OffsetTimeOriginal', 'OffsetTime', 'TimeZoneOffset']),
    gpsLatitude,
    gpsLongitude,
    gpsAltitude: pickNumber(original, ['GPSAltitude', 'altitude', 'gpsAltitude']),
    cameraMake,
    cameraModel,
    lens: pickString(original, ['LensModel', 'Lens', 'LensInfo']),
    focalLength: formatMm(pickString(original, ['FocalLength', 'FocalLengthIn35mmFormat'])),
    exposureTime: formatExposure(pickString(original, ['ExposureTime', 'ShutterSpeedValue'])),
    aperture: pickString(original, ['FNumber', 'ApertureValue'])
      ? `f/${pickString(original, ['FNumber', 'ApertureValue'])}`
      : null,
    iso: pickString(original, ['ISO', 'ISOSpeedRatings', 'PhotographicSensitivity']),
    flash: pickString(original, ['Flash', 'flash']),
    orientation: pickString(original, ['Orientation', 'orientation']),
    software,
    width: pickNumber(original, ['ExifImageWidth', 'PixelXDimension', 'ImageWidth']),
    height: pickNumber(original, ['ExifImageHeight', 'PixelYDimension', 'ImageHeight']),
    whiteBalance: pickString(original, ['WhiteBalance']),
    meteringMode: pickString(original, ['MeteringMode']),
    exposureProgram: pickString(original, ['ExposureProgram']),
    colorSpace: pickString(original, ['ColorSpace']),
    sceneCaptureType: pickString(original, ['SceneCaptureType']),
    lightSource: pickString(original, ['LightSource']),
    metadataPreserved: hasAny,
  };
}

export function formatGpsPair(lat: number | null, lng: number | null, extra?: string | null): string | null {
  if (lat == null || lng == null) return null;
  const core = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return extra ? `${core} · ${extra}` : core;
}
