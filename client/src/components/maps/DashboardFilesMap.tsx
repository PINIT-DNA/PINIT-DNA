import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isValidMapCoordinate } from '../../lib/geo-coords';
import { formatDistanceToNow } from 'date-fns';
import { leafletBasemapCredit, leafletBasemapLayer } from './leafletBasemap';

export interface DashboardFileMapPoint {
  id?: string;
  vaultId?: string | null;
  filename: string;
  token?: string;
  lat: number;
  lng: number;
  locationLabel: string;
  action?: string;
  source?: 'gps' | 'ip';
  timestamp?: string;
  device?: string | null;
}

interface DashboardFilesMapProps {
  points: DashboardFileMapPoint[];
  height?: string;
  fill?: boolean;
  live?: boolean;
  onSelectPoint?: (point: DashboardFileMapPoint) => void;
}

const ACTION_COLORS: Record<string, string> = {
  VIEWED: '#3b82f6',
  DOWNLOADED: '#10b981',
  FORWARDING_DETECTED: '#f97316',
  COPY_ATTEMPT: '#eab308',
  SCREENSHOT_ATTEMPT: '#ef4444',
  SCREEN_RECORDING_ATTEMPT: '#ec4899',
  PRINT_ATTEMPT: '#ef4444',
  DOWNLOAD_STARTED: '#34d399',
  SHARE_FURTHER: '#f97316',
};

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
    html: `
      <div style="position:relative;width:26px;height:26px">
        <svg viewBox="0 0 26 26" width="26" height="26">
          <path d="M13 2C8.6 2 5 5.6 5 10c0 6.5 8 14 8 14s8-7.5 8-14c0-4.4-3.6-8-8-8z"
                fill="${color}" stroke="#fff" stroke-width="1.5"/>
          <circle cx="13" cy="10" r="3" fill="#fff"/>
        </svg>
      </div>
    `,
  });
}

function actionLabel(action?: string): string {
  if (!action) return 'Access';
  return action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

export function DashboardFilesMap({ points, height, fill, live, onSelectPoint }: DashboardFilesMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const validPoints = points.filter(p => isValidMapCoordinate(p.lat, p.lng));
  const mapHeight = fill ? undefined : (height ?? '280px');

  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

    const map = L.map(mapRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      worldCopyJump: true,
      attributionControl: false,
    });
    mapInstance.current = map;

    leafletBasemapLayer('light').addTo(map);

    const markers: L.LatLng[] = [];

    validPoints.forEach((p) => {
      const latlng = L.latLng(p.lat, p.lng);
      markers.push(latlng);
      const color = ACTION_COLORS[p.action ?? ''] ?? '#6366f1';
      const marker = L.marker(latlng, { icon: pinIcon(color) });
      const when = p.timestamp
        ? formatDistanceToNow(new Date(p.timestamp), { addSuffix: true })
        : '';
      marker.bindPopup(`
        <div style="font-family:Inter,system-ui,sans-serif;min-width:200px">
          <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:4px">${p.filename}</div>
          <div style="font-size:11px;color:#6366f1;font-weight:600;margin-bottom:4px">${actionLabel(p.action)}</div>
          <div style="font-size:11px;color:#64748b">${p.locationLabel}</div>
          ${p.device ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px">${p.device}</div>` : ''}
          ${when ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px">${when}</div>` : ''}
          <div style="font-size:10px;color:#64748b;margin-top:2px">${p.source === 'gps' ? 'Precise GPS (permission granted)' : 'Approximate IP/network location'}</div>
        </div>
      `);
      if (onSelectPoint) {
        marker.on('click', () => onSelectPoint(p));
      }
      marker.addTo(map);
    });

    if (markers.length === 1) {
      map.setView(markers[0], 6);
    } else if (markers.length > 1) {
      map.fitBounds(L.latLngBounds(markers), { padding: [32, 32], maxZoom: 8 });
    } else {
      map.setView([20, 0], 2);
    }

    const ro = fill && wrapRef.current
      ? new ResizeObserver(() => {
          map.invalidateSize();
          if (markers.length > 1) {
            map.fitBounds(L.latLngBounds(markers), { padding: [32, 32], maxZoom: 8 });
          }
        })
      : null;
    ro?.observe(wrapRef.current!);
    requestAnimationFrame(() => map.invalidateSize());
    const t = window.setTimeout(() => map.invalidateSize(), 150);

    return () => {
      window.clearTimeout(t);
      ro?.disconnect();
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [points, fill]);

  if (validPoints.length === 0) {
    return (
      <div
        ref={wrapRef}
        style={mapHeight ? { height: mapHeight } : undefined}
        className={`rounded-lg flex items-center justify-center border border-bg-border bg-bg-elevated/50 ${fill ? 'flex-1 min-h-[200px] w-full' : 'w-full'}`}
      >
        <div className="text-center px-4">
          <p className="text-xs text-gray-500">No share access locations yet</p>
          <p className="text-2xs text-gray-600 mt-1">
            Share a file from Vault — when someone opens the link, their location appears here live
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className={`relative w-full ${fill ? 'h-full min-h-[240px]' : ''}`}
      style={!fill && mapHeight ? { height: mapHeight } : undefined}
    >
      <div
        ref={mapRef}
        className={`rounded-lg overflow-hidden border border-bg-border w-full h-full absolute inset-0 dashboard-map-fill`}
      />
      <div className="absolute bottom-2 left-2 right-2 z-[400] flex items-center justify-center gap-3 flex-wrap rounded-md bg-bg-card/90 backdrop-blur-sm border border-bg-border px-3 py-1.5 text-2xs text-gray-500 pointer-events-none">
        {live && (
          <span className="flex items-center gap-1 text-success">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            Live
          </span>
        )}
        <span>{validPoints.length} access location{validPoints.length !== 1 ? 's' : ''}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Viewed</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Downloaded</span>
        <span className="opacity-40 text-[10px]">{leafletBasemapCredit()}</span>
      </div>
    </div>
  );
}
