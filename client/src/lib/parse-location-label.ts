import { isValidMapCoordinate } from './geo-coords';

/** Parse "12.34567, 78.90123" style labels from custody location fields. */
export function parseCoordsFromLabel(label?: string | null): { lat: number; lng: number } | null {
  if (!label) return null;
  const trimmed = label.trim();
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return isValidMapCoordinate(lat, lng) ? { lat, lng } : null;
}

export function bestCoordsFromLocation(loc?: {
  presentLabel?: string;
  creationLabel?: string;
  sharedLabel?: string;
  lastKnownLabel?: string;
  latitude?: number;
  longitude?: number;
} | null): { lat: number; lng: number; label: string } | null {
  if (loc?.latitude != null && loc?.longitude != null && isValidMapCoordinate(loc.latitude, loc.longitude)) {
    const label = loc.presentLabel ?? loc.creationLabel ?? loc.sharedLabel ?? loc.lastKnownLabel
      ?? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
    return { lat: loc.latitude, lng: loc.longitude, label };
  }
  if (!loc) return null;
  for (const label of [
    loc.presentLabel,
    loc.creationLabel,
    loc.sharedLabel,
    loc.lastKnownLabel,
  ]) {
    const coords = parseCoordsFromLabel(label);
    if (coords) return { ...coords, label: label! };
  }
  return null;
}
