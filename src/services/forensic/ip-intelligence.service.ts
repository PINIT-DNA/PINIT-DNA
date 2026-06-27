import axios from 'axios';
import { isPrivateIp } from '../../lib/geo-coords';

export interface IpIntelligenceResult {
  ip: string;
  country: string;
  countryCode: string;
  city: string;
  region: string;
  isp: string;
  org: string;
  asn: string;
  timezone: string;
  lat: number;
  lng: number;
  isVpn: boolean;
  isTor: boolean;
  isProxy: boolean;
  isDatacenter: boolean;
  abuseScore: number;
}

const TOR_EXIT_NODES = new Set<string>();
let torFetchedAt = 0;

async function fetchTorExitNodes(): Promise<void> {
  if (Date.now() - torFetchedAt < 3600000) return;
  try {
    const res = await axios.get('https://check.torproject.org/torbulkexitlist', { timeout: 5000 });
    const lines = (res.data as string).split('\n').filter(l => l.trim() && !l.startsWith('#'));
    TOR_EXIT_NODES.clear();
    lines.forEach(ip => TOR_EXIT_NODES.add(ip.trim()));
    torFetchedAt = Date.now();
  } catch {
    // non-fatal
  }
}

export async function getIpIntelligence(ip: string): Promise<IpIntelligenceResult> {
  await fetchTorExitNodes().catch(() => {});

  const isPrivate = isPrivateIp(ip);
  if (isPrivate) {
    return {
      ip, country: 'Local Network', countryCode: '--', city: 'Local', region: '',
      isp: 'Private', org: 'Private', asn: '', timezone: '',
      lat: 0, lng: 0, isVpn: false, isTor: false, isProxy: false, isDatacenter: false,
      abuseScore: 0,
    };
  }

  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,regionName,isp,org,as,timezone,lat,lon,proxy,hosting`, { timeout: 4000 });
    const d = res.data as any;

    const isTor = TOR_EXIT_NODES.has(ip);
    const isProxy = d.proxy === true;
    const isDatacenter = d.hosting === true;
    const isVpn = isProxy && !isTor;

    const asnMatch = (d.as || '').match(/^AS(\d+)/);
    const asn = asnMatch ? `AS${asnMatch[1]}` : '';

    return {
      ip,
      country: d.country || '',
      countryCode: d.countryCode || '',
      city: d.city || '',
      region: d.regionName || '',
      isp: d.isp || '',
      org: d.org || '',
      asn,
      timezone: d.timezone || '',
      lat: d.lat || 0,
      lng: d.lon || 0,
      isVpn,
      isTor,
      isProxy,
      isDatacenter,
      abuseScore: isTor ? 90 : isProxy ? 60 : isDatacenter ? 30 : 0,
    };
  } catch {
    return {
      ip, country: '', countryCode: '', city: '', region: '',
      isp: '', org: '', asn: '', timezone: '',
      lat: 0, lng: 0, isVpn: false, isTor: false, isProxy: false, isDatacenter: false,
      abuseScore: 0,
    };
  }
}
