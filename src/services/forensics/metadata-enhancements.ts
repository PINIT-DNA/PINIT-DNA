/**
 * Layer 5 metadata enhancements — extended EXIF provenance for forensic bundle.
 */
import crypto from 'crypto';
import { dnaEnhancements } from '../../config/dna-enhancements';
import type { MetadataEnhancementData } from '../../types/dna-enhancements.types';

type ExifRecord = Record<string, unknown>;

function str(obj: ExifRecord | null, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function editIndicators(exif: ExifRecord | null): string[] {
  if (!exif) return [];
  const indicators: string[] = [];
  const software = str(exif, ['Software', 'software', 'ProcessingSoftware']);
  if (software) indicators.push(`software:${software}`);
  const history = exif['History'];
  if (history) indicators.push('xmp:history-present');
  const modifyDate = str(exif, ['ModifyDate', 'DateTimeDigitized', 'MetadataDate']);
  if (modifyDate) indicators.push(`modified:${modifyDate}`);
  return indicators;
}

async function parseExif(buffer: Buffer): Promise<ExifRecord | null> {
  try {
    const exifr = await import('exifr');
    const data = await exifr.parse(buffer, { iptc: true, xmp: true, tiff: true });
    return (data as ExifRecord) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadataEnhancements(buffer: Buffer): Promise<MetadataEnhancementData | undefined> {
  if (!dnaEnhancements.enabled || !dnaEnhancements.layer5.extendedExif) return undefined;

  const exif = await parseExif(buffer);
  const cameraModel = str(exif, ['Model', 'model']);
  const lensModel = str(exif, ['LensModel', 'Lens', 'lens']);
  const firmware = str(exif, ['SoftwareVersion', 'FirmwareVersion']);
  const timezone = str(exif, ['OffsetTime', 'OffsetTimeOriginal', 'TimeZone']);
  const deviceFingerprint = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        make: str(exif, ['Make', 'make']),
        model: cameraModel,
        lens: lensModel,
        serial: str(exif, ['BodySerialNumber', 'SerialNumber']),
      }),
    )
    .digest('hex')
    .slice(0, 32);

  const stable = {
    cameraModel,
    lensModel,
    firmware,
    timezone,
    deviceFingerprint,
    editHistoryIndicators: editIndicators(exif),
  };

  const exifFingerprint = crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');

  return {
    ...stable,
    exifFingerprint,
  };
}

export function verifyMetadataEnhancements(
  probe: MetadataEnhancementData,
  stored: MetadataEnhancementData,
): number {
  if (probe.exifFingerprint && stored.exifFingerprint) {
    return probe.exifFingerprint === stored.exifFingerprint ? 1 : 0;
  }

  const fields: (keyof MetadataEnhancementData)[] = [
    'cameraModel',
    'lensModel',
    'firmware',
    'timezone',
    'deviceFingerprint',
  ];
  let matches = 0;
  let total = 0;
  for (const f of fields) {
    const p = probe[f];
    const s = stored[f];
    if (p && s) {
      total++;
      if (p === s) matches++;
    }
  }
  return total > 0 ? matches / total : 0;
}
