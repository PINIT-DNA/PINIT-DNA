/** Reject null island, out-of-range, and junk coordinates for map display. */
export function isValidMapCoordinate(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

export function sanitizeCoordinatePair(
  lat: number | null | undefined,
  lng: number | null | undefined,
): { lat: number; lng: number } | null {
  if (!isValidMapCoordinate(lat, lng)) return null;
  return { lat: lat!, lng: lng! };
}

export function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  const clean = ip.replace('::ffff:', '');
  return clean === '::1'
    || clean === '127.0.0.1'
    || clean.startsWith('127.')
    || clean.startsWith('192.168.')
    || clean.startsWith('10.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(clean);
}
