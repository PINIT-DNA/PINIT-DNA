/**
 * Reverse-geocode recorded GPS to a place name (Nominatim).
 * Used only when lat/lng are already stored. Never invents a city.
 */
import { isValidMapCoordinate } from './geo-coords';

export type ReverseGeocodePlace = {
  village: string | null;
  mandal: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  fullAddress: string | null;
  label: string | null;
};

type NominatimAddress = Record<string, string | undefined>;

const cache = new Map<string, ReverseGeocodePlace>();

function parseIndianAddress(a: NominatimAddress, displayName?: string): ReverseGeocodePlace {
  const village = a.village || a.hamlet || a.isolated_dwelling || a.neighbourhood || a.suburb || a.locality || null;
  const mandal = a.municipality || a.county || a.city_district || a.town || null;
  const district = a.state_district || a.district || null;
  const city = a.city || a.town || a.municipality || village;
  const state = a.state || null;
  const pincode = a.postcode || null;
  const country = a.country || null;
  const parts = [village && village !== city ? village : null, city, mandal && mandal !== city ? mandal : null, district, state, pincode, country]
    .filter((p, i, arr) => Boolean(p) && arr.findIndex((x) => x === p) === i) as string[];
  const label = parts.join(', ') || displayName || null;
  return {
    village,
    mandal,
    district,
    city,
    state,
    pincode,
    country,
    fullAddress: displayName || null,
    label,
  };
}

function emptyPlace(): ReverseGeocodePlace {
  return {
    village: null, mandal: null, district: null, city: null,
    state: null, pincode: null, country: null, fullAddress: null, label: null,
  };
}

export async function reverseGeocodePlace(lat: number, lng: number): Promise<ReverseGeocodePlace> {
  if (!isValidMapCoordinate(lat, lng)) return emptyPlace();
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(String(lat))}`
      + `&lon=${encodeURIComponent(String(lng))}&format=json&addressdetails=1&zoom=18`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'PINIT-DNA-Hub/1.0 (ask-pinit reverse-geocode)',
      },
    });
    if (!res.ok) {
      cache.set(key, emptyPlace());
      return emptyPlace();
    }
    const body = await res.json() as { display_name?: string; address?: NominatimAddress };
    const place = parseIndianAddress(body.address ?? {}, body.display_name);
    cache.set(key, place);
    return place;
  } catch {
    return emptyPlace();
  } finally {
    clearTimeout(timer);
  }
}
