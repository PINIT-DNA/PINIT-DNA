import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isValidMapCoordinate } from '../../lib/geo-coords';

export type AccessKind = 'direct_recipient' | 'direct_share' | 'reshared';

interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  hopNumber: number;
  country: string;
  city: string | null;
  device: string;
  ip: string;
  riskLevel: string;
  totalActions: number;
  gpsVillage?: string | null;
  gpsMandal?: string | null;
  gpsDistrict?: string | null;
  gpsState?: string | null;
  gpsPincode?: string | null;
  gpsAccuracy?: number | null;
  gpsFullAddress?: string | null;
  locationSource?: string | null;
  /** Green / blue / red pin role */
  accessKind?: AccessKind;
}

interface FileTrackingMapProps {
  points: MapPoint[];
  height?: string;
}

/** Pin colors: Direct Recipient = green, Direct Share = blue, Reshared = red */
export const ACCESS_KIND_COLORS: Record<AccessKind, string> = {
  direct_recipient: '#10b981',
  direct_share: '#3b82f6',
  reshared: '#ef4444',
};

export const ACCESS_KIND_LABELS: Record<AccessKind, string> = {
  direct_recipient: 'Direct Recipient',
  direct_share: 'Direct Share',
  reshared: 'Reshared',
};

function resolveAccessKind(hop: number, kind?: AccessKind): AccessKind {
  if (kind) return kind;
  // Fallback when hop metadata missing: hop 1 = recipient, rest = reshared
  return hop === 1 ? 'direct_recipient' : 'reshared';
}

function getColor(hop: number, kind?: AccessKind): string {
  return ACCESS_KIND_COLORS[resolveAccessKind(hop, kind)];
}

function createPinIcon(hop: number, riskLevel: string, accessKind?: AccessKind): L.DivIcon {
  // Risk override only for CRITICAL; HIGH keeps role color so reshared stays red
  const color = riskLevel === 'CRITICAL' ? '#ef4444' : getColor(hop, accessKind);
  const pulse = riskLevel === 'CRITICAL' || riskLevel === 'HIGH' ? 'animation: pulse 1.5s infinite;' : '';

  return L.divIcon({
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
    html: `
      <div style="position:relative;width:36px;height:36px;${pulse}">
        <svg viewBox="0 0 36 36" width="36" height="36">
          <path d="M18 2C11.4 2 6 7.4 6 14c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12z"
                fill="${color}" stroke="#fff" stroke-width="2"/>
          <circle cx="18" cy="14" r="6" fill="#fff"/>
          <text x="18" y="17" text-anchor="middle" font-size="9" font-weight="bold" fill="${color}">${hop}</text>
        </svg>
      </div>
    `,
  });
}

export function FileTrackingMap({ points, height = '400px' }: FileTrackingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    const validPoints = points.filter(p => isValidMapCoordinate(p.lat, p.lng));
    if (!mapRef.current || validPoints.length === 0) return;

    // Clean up previous map
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

    const map = L.map(mapRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
    });
    mapInstance.current = map;

    // Dark tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 18,
    }).addTo(map);

    const markers: L.LatLng[] = [];

    // Add markers
    validPoints.forEach((p) => {
      const latlng = L.latLng(p.lat, p.lng);
      markers.push(latlng);

      const kind = resolveAccessKind(p.hopNumber, p.accessKind);
      const marker = L.marker(latlng, { icon: createPinIcon(p.hopNumber, p.riskLevel, kind) });

      const riskBadge = p.riskLevel === 'CRITICAL' || p.riskLevel === 'HIGH'
        ? `<span style="background:${p.riskLevel === 'CRITICAL' ? '#ef4444' : '#f97316'};color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:4px">${p.riskLevel}</span>`
        : '';

      const kindColor = ACCESS_KIND_COLORS[kind];
      const kindLabel = ACCESS_KIND_LABELS[kind];

      const locationLines = p.gpsFullAddress
        ? p.gpsFullAddress.replace(/,/g, '<br/>')
        : p.gpsVillage
        ? [
            p.gpsVillage,
            [p.gpsMandal, p.gpsDistrict].filter(Boolean).join(', '),
            [p.gpsState, p.gpsPincode].filter(Boolean).join(' '),
            p.country,
          ].filter(Boolean).join('<br/>')
        : `${p.city ? p.city + ', ' : ''}${p.country}`;

      const accuracyBadge = p.gpsAccuracy
        ? `<div style="font-size:10px;color:#10b981;margin-top:2px">📡 Accuracy: ±${p.gpsAccuracy < 1000 ? Math.round(p.gpsAccuracy) + 'm' : Math.round(p.gpsAccuracy / 1000) + 'km'}</div>`
        : p.locationSource === 'ip'
          ? `<div style="font-size:10px;color:#eab308;margin-top:2px">🌐 IP-based location (approximate)</div>`
          : '';

      marker.bindPopup(`
        <div style="font-family:Inter,system-ui,sans-serif;min-width:220px">
          <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:6px">
            Hop ${p.hopNumber} — ${kindLabel}
            ${riskBadge}
          </div>
          <div style="font-size:10px;font-weight:600;color:${kindColor};margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em">
            ${kindLabel}
          </div>
          <div style="font-size:11px;color:#666;line-height:1.5">
            <div style="margin-bottom:4px">📍 <strong>${locationLines}</strong></div>
            <div>🌐 IP: <code style="background:#f1f5f9;padding:1px 4px;border-radius:3px">${p.ip}</code></div>
            <div>📱 ${p.device}</div>
            <div>👁 ${p.totalActions} action${p.totalActions > 1 ? 's' : ''}</div>
            ${accuracyBadge}
            <div style="font-size:10px;color:#999;margin-top:4px">
              ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}
            </div>
          </div>
        </div>
      `, { maxWidth: 300 });

      marker.addTo(map);
    });

    // Draw polyline connecting hops in order
    if (markers.length > 1) {
      const sortedPoints = [...validPoints].sort((a, b) => a.hopNumber - b.hopNumber);
      const lineCoords = sortedPoints.map(p => L.latLng(p.lat, p.lng));

      L.polyline(lineCoords, {
        color: '#64748b',
        weight: 2,
        opacity: 0.7,
        dashArray: '8, 8',
      }).addTo(map);

      // Arrow markers along the path
      for (let i = 0; i < lineCoords.length - 1; i++) {
        const mid = L.latLng(
          (lineCoords[i].lat + lineCoords[i + 1].lat) / 2,
          (lineCoords[i].lng + lineCoords[i + 1].lng) / 2
        );
        L.marker(mid, {
          icon: L.divIcon({
            className: '',
            iconSize: [20, 20],
            html: `<div style="color:#94a3b8;font-size:14px;text-align:center">→</div>`,
          }),
        }).addTo(map);
      }
    }

    // Fit bounds
    if (markers.length === 1) {
      map.setView(markers[0], 8);
    } else if (markers.length > 1) {
      map.fitBounds(L.latLngBounds(markers), { padding: [40, 40], maxZoom: 10 });
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [points]);

  const validCount = points.filter(p => isValidMapCoordinate(p.lat, p.lng)).length;

  if (validCount === 0) {
    return (
      <div style={{ height }} className="bg-bg-elevated rounded-lg flex items-center justify-center border border-bg-border">
        <div className="text-center">
          <p className="text-xs text-gray-500">No location data available yet</p>
          <p className="text-2xs text-gray-600 mt-1">Map appears when viewers share GPS or IP geolocation is resolved</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={mapRef}
        style={{ height, width: '100%', borderRadius: '12px', overflow: 'hidden' }}
        className="border border-bg-border"
      />
      <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap gap-2 rounded-lg bg-black/70 backdrop-blur-sm px-2.5 py-2 border border-white/10">
        {(Object.keys(ACCESS_KIND_COLORS) as AccessKind[]).map((kind) => (
          <span key={kind} className="flex items-center gap-1.5 text-2xs text-white/90">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border border-white/40"
              style={{ backgroundColor: ACCESS_KIND_COLORS[kind] }}
            />
            {ACCESS_KIND_LABELS[kind]}
          </span>
        ))}
      </div>
    </div>
  );
}
