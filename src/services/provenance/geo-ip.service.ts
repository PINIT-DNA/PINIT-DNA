/**
 * Geo-IP for custody events — never invents location.
 * Wraps existing share-link geo helper (no new dependency).
 */
import { geoFromIp as resolveGeo } from '../share/share-link.service';

export interface GeoIpResult {
  country?: string;
  region?: string;
  city?: string;
  isp?: string;
  locationSource: 'ip' | 'none';
}

export async function lookupGeoIp(ip: string | null | undefined): Promise<GeoIpResult> {
  if (!ip?.trim()) return { locationSource: 'none' };
  try {
    const geo = await resolveGeo(ip);
    const has = !!(geo.country || geo.city || geo.region);
    return {
      country: geo.country,
      region: geo.region,
      city: geo.city,
      isp: geo.isp,
      locationSource: has ? 'ip' : 'none',
    };
  } catch {
    return { locationSource: 'none' };
  }
}
