import { requestCustodyLocation, type CustodyLocation } from './location-consent';

export type ProtectCaptureContext = {
  locationShared?: boolean;
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
  timezone?: string;
  captureMethod?: string;
  deviceModel?: string;
  software?: string;
  capturedAt?: string;
  width?: number;
  height?: number;
};

const METHOD_KEY = 'pinitCaptureMethod';

export function tagProtectFile(file: File, method: string): File {
  try {
    Object.defineProperty(file, METHOD_KEY, { value: method, enumerable: false });
  } catch {
    (file as File & { pinitCaptureMethod?: string }).pinitCaptureMethod = method;
  }
  return file;
}

export function readProtectMethod(file: File): string {
  const tagged = (file as File & { pinitCaptureMethod?: string }).pinitCaptureMethod;
  return tagged?.trim() || 'Upload';
}

function guessDevice(): string {
  const ua = navigator.userAgent || '';
  const uaData = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; mobile?: boolean; platform?: string } }).userAgentData;
  if (uaData?.platform) {
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    return uaData.platform;
  }
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  const android = ua.match(/;\s*([^;)]+)\s+Build\//);
  if (android?.[1]) return android[1].trim();
  if (/Android/.test(ua)) return 'Android device';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux';
  return navigator.platform || 'This device';
}

function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export async function collectProtectCaptureContext(file: File): Promise<ProtectCaptureContext & { location: CustodyLocation | null }> {
  const locPromise = requestCustodyLocation();
  const dims = await readImageSize(file);
  const method = readProtectMethod(file);
  const loc = await Promise.race([
    locPromise,
    new Promise<CustodyLocation | null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
  return {
    location: loc,
    locationShared: Boolean(loc),
    latitude: loc?.latitude,
    longitude: loc?.longitude,
    gpsAccuracy: loc?.accuracy,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    captureMethod: method === 'Upload' ? 'Upload' : method,
    deviceModel: guessDevice(),
    software: method === 'Upload' ? 'PinIT HUB' : 'PinIT Camera',
    capturedAt: new Date().toISOString(),
    width: dims?.width,
    height: dims?.height,
  };
}
