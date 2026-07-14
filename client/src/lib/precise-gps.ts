/**
 * High-accuracy browser geolocation + India-aware reverse geocode (Nominatim).
 */

export type GpsCapture = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: string;
  city?: string;
  village?: string;
  mandal?: string;
  district?: string;
  state?: string;
  pincode?: string;
  fullAddress?: string;
  locationSource: 'gps' | 'network';
};

type NominatimAddress = Record<string, string | undefined>;

/** Map OSM address fields to Indian admin labels (village / mandal / district). */
export function parseIndianAddress(a: NominatimAddress, displayName?: string): Partial<GpsCapture> {
  const village =
    a.village ||
    a.hamlet ||
    a.isolated_dwelling ||
    a.neighbourhood ||
    a.suburb ||
    a.locality;

  // In much of Telangana/AP, OSM uses county or municipality for mandal/tehsil
  const mandal =
    a.municipality ||
    a.county ||
    a.city_district ||
    a.district ||
    a.town;

  const district =
    a.state_district ||
    a.district ||
    (a.county && a.municipality ? a.county : undefined);

  const city = a.city || a.town || a.municipality || village;
  const state = a.state;
  const pincode = a.postcode;

  return {
    village: village || undefined,
    mandal: mandal || undefined,
    district: district || undefined,
    city: city || undefined,
    state: state || undefined,
    pincode: pincode || undefined,
    fullAddress: displayName || undefined,
  };
}

export async function reverseGeocode(lat: number, lng: number): Promise<Partial<GpsCapture>> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(String(lat))}` +
      `&lon=${encodeURIComponent(String(lng))}&format=json&addressdetails=1&zoom=18`;
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return {};
    const j = (await r.json()) as { display_name?: string; address?: NominatimAddress };
    return parseIndianAddress(j.address ?? {}, j.display_name);
  } catch {
    return {};
  }
}

function classifySource(accuracy: number): 'gps' | 'network' {
  // Device GPS outdoors is typically < 50m; WiFi/cell is often 100m–few km
  return accuracy <= 75 ? 'gps' : 'network';
}

/**
 * Watch the device position until we get a good fix (or timeout).
 * Prefers the reading with the smallest accuracy radius.
 */
export function captureBestGps(opts?: {
  targetAccuracyM?: number;
  maxWaitMs?: number;
  minSamples?: number;
}): Promise<GpsCapture | null> {
  const targetAccuracyM = opts?.targetAccuracyM ?? 50;
  const maxWaitMs = opts?.maxWaitMs ?? 28_000;
  const minSamples = opts?.minSamples ?? 1;

  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    let best: GeolocationPosition | null = null;
    let samples = 0;
    let settled = false;

    const finish = async (pos: GeolocationPosition | null) => {
      if (settled) return;
      settled = true;
      try {
        watcher != null && navigator.geolocation.clearWatch(watcher);
      } catch { /* ignore */ }
      clearTimeout(timer);

      if (!pos) {
        resolve(null);
        return;
      }

      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      const geo = await reverseGeocode(lat, lng);
      resolve({
        lat,
        lng,
        accuracy,
        timestamp: new Date(pos.timestamp).toISOString(),
        locationSource: classifySource(accuracy),
        ...geo,
      });
    };

    const consider = (pos: GeolocationPosition) => {
      samples += 1;
      if (!best || pos.coords.accuracy < best.coords.accuracy) {
        best = pos;
      }
      // Good enough GPS fix
      if (best.coords.accuracy <= targetAccuracyM && samples >= minSamples) {
        void finish(best);
      }
    };

    const timer = setTimeout(() => {
      void finish(best);
    }, maxWaitMs);

    let watcher: number | null = null;
    try {
      watcher = navigator.geolocation.watchPosition(
        consider,
        () => {
          // Keep waiting until timeout if transient errors
          if (samples === 0 && !best) {
            // soft fail — timeout will resolve null or last best
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: maxWaitMs,
        },
      );
    } catch {
      clearTimeout(timer);
      resolve(null);
    }

    // Also kick getCurrentPosition immediately (some browsers need both)
    navigator.geolocation.getCurrentPosition(
      consider,
      () => { /* wait for watch / timeout */ },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );
  });
}

export function locationLabel(accuracy: number | null | undefined, source: string | null | undefined): string {
  if (source === 'ip') return '🌐 IP Lookup (city / ISP — not GPS)';
  if (accuracy != null && accuracy <= 50) return '📍 GPS (precise)';
  if (accuracy != null && accuracy <= 150) return '📍 GPS / assisted (good)';
  if (source === 'gps' || source === 'network') {
    if (accuracy != null && accuracy <= 1000) return '📡 Network location (approximate — enable precise GPS on phone)';
    return '📡 Coarse network / Wi‑Fi location (not village-accurate)';
  }
  return '🌐 Location approximate';
}
