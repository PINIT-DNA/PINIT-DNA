import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isValidMapCoordinate } from '../../lib/geo-coords';
import { formatDistanceToNow, format } from 'date-fns';
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
  /** Opt-in premium presentation for the Home dashboard's "Where assets were
   * opened" card: groups same-location accesses into one marker with a real
   * count, custom circular markers, dynamic legend, styled zoom controls.
   * Defaults to false so every other caller (e.g. AccessIntelligencePage's
   * per-asset map) keeps its exact current look and per-point click behavior. */
  premium?: boolean;
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
const DEFAULT_ACTION_COLOR = '#2f7cf6';

function actionLabel(action?: string): string {
  if (!action) return 'Access';
  return action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

/** Original teardrop pin — unchanged, still used whenever `premium` isn't
 * explicitly enabled (e.g. AccessIntelligencePage's per-asset map). */
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

/** A single PINIT-style marker: white glass circle, blue border, a filled
 * dot standing in for "location", plus a small count badge when more than
 * one real access shares this spot. Hover scale/glow is a plain CSS class
 * (.pinit-map-marker) so it works on the raw DOM node Leaflet mounts. */
function pinIconPremium(color: string, count: number): L.DivIcon {
  const size = 30;
  const badge = count > 1
    ? `<span style="position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 3px;
         border-radius:9999px;background:${color};color:#fff;font:700 9px/16px 'Plus Jakarta Sans',system-ui,sans-serif;
         text-align:center;box-shadow:0 0 0 2px #fff;">${count > 99 ? '99+' : count}</span>`
    : '';
  return L.divIcon({
    className: 'pinit-map-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 2],
    html: `
      <div class="pinit-map-marker-inner" style="position:relative;width:${size}px;height:${size}px;">
        <span style="position:absolute;inset:0;border-radius:9999px;background:#ffffff;border:2px solid ${color};
          box-shadow:0 0 0 4px ${color}26, 0 4px 10px -2px ${color}66;display:flex;align-items:center;justify-content:center;">
          <span style="width:10px;height:10px;border-radius:9999px;background:${color};"></span>
        </span>
        ${badge}
      </div>
    `,
  });
}

interface LocationGroup {
  lat: number;
  lng: number;
  locationLabel: string;
  count: number;
  latestTimestamp?: string;
  latestAction?: string;
  points: DashboardFileMapPoint[];
}

/** Groups raw access events that share a location (rounded to ~100m) into
 * one marker with a real access count — never a fabricated number. */
function groupByLocation(points: DashboardFileMapPoint[]): LocationGroup[] {
  const groups = new Map<string, LocationGroup>();
  for (const p of points) {
    const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        lat: p.lat,
        lng: p.lng,
        locationLabel: p.locationLabel,
        count: 1,
        latestTimestamp: p.timestamp,
        latestAction: p.action,
        points: [p],
      });
      continue;
    }
    existing.count += 1;
    existing.points.push(p);
    if (p.timestamp && (!existing.latestTimestamp || p.timestamp > existing.latestTimestamp)) {
      existing.latestTimestamp = p.timestamp;
      existing.latestAction = p.action;
    }
  }
  return [...groups.values()];
}

export function DashboardFilesMap({ points, height, fill, live, onSelectPoint, premium }: DashboardFilesMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const validPoints = points.filter(p => isValidMapCoordinate(p.lat, p.lng));
  const mapHeight = fill ? undefined : (height ?? '280px');
  const locationGroups = premium ? groupByLocation(validPoints) : [];
  const presentActions = premium
    ? [...new Set(validPoints.map((p) => p.action).filter((a): a is string => typeof a === 'string' && a in ACTION_COLORS))]
    : [];

  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

    const map = L.map(mapRef.current, {
      zoomControl: !premium,
      scrollWheelZoom: false,
      worldCopyJump: true,
      attributionControl: false,
    });
    mapInstance.current = map;
    if (premium) {
      L.control.zoom({ position: 'topleft' }).addTo(map);
    }

    leafletBasemapLayer('light').addTo(map);

    const markers: L.LatLng[] = [];

    if (premium) {
      locationGroups.forEach((g) => {
        const latlng = L.latLng(g.lat, g.lng);
        markers.push(latlng);
        const color = ACTION_COLORS[g.latestAction ?? ''] ?? DEFAULT_ACTION_COLOR;
        const marker = L.marker(latlng, { icon: pinIconPremium(color, g.count) });
        const when = g.latestTimestamp ? format(new Date(g.latestTimestamp), 'MMM d, h:mm a') : '';
        marker.bindPopup(`
          <div style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;min-width:190px">
            <div style="font-size:13px;font-weight:700;color:#0b1b33;margin-bottom:3px">${g.locationLabel}</div>
            <div style="font-size:12px;color:#2f7cf6;font-weight:600;margin-bottom:4px">${g.count} ${g.count === 1 ? 'access' : 'accesses'}</div>
            ${when ? `<div style="font-size:11px;color:#64748b">Last opened: ${when}</div>` : ''}
          </div>
        `);
        if (onSelectPoint) {
          const latest = g.points.find((p) => p.timestamp === g.latestTimestamp) ?? g.points[0];
          marker.on('click', () => onSelectPoint(latest));
        }
        marker.addTo(map);
      });
    } else {
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
    }

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
  }, [points, fill, premium]);

  if (validPoints.length === 0 && !premium) {
    return (
      <div
        ref={wrapRef}
        style={mapHeight ? { height: mapHeight } : undefined}
        className={`rounded-lg flex items-center justify-center border border-bg-border bg-bg-elevated/50 ${fill ? 'flex-1 min-h-[200px] w-full' : 'w-full'}`}
      >
        <div className="text-center px-4">
          <p className="text-xs text-gray-500">No share access locations yet</p>
          <p className="text-2xs text-gray-600 mt-1">
            Share a file from My Assets — when someone opens the link, their location appears here live
          </p>
        </div>
      </div>
    );
  }

  if (validPoints.length === 0 && premium) {
    return (
      <div
        ref={wrapRef}
        className={`relative w-full pinit-map-premium ${fill ? 'h-full min-h-[240px]' : ''}`}
        style={!fill && mapHeight ? { height: mapHeight } : undefined}
      >
        <div
          ref={mapRef}
          className="rounded-xl overflow-hidden border border-bg-border w-full h-full absolute inset-0 dashboard-map-fill"
        />
        <div className="pinit-map-top-gradient" />
        <div className="absolute inset-0 z-[400] flex items-center justify-center pointer-events-none">
          <div className="text-center px-4 py-3 rounded-lg bg-bg-card/90 backdrop-blur-sm border border-bg-border">
            <p className="text-xs text-gray-500">No share access locations yet</p>
            <p className="text-2xs text-gray-600 mt-1">
              Share a file from My Assets — when someone opens the link, their location appears here live
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (premium) {
    const locationCount = locationGroups.length;
    return (
      <div
        ref={wrapRef}
        className={`relative w-full pinit-map-premium ${fill ? 'h-full min-h-[240px]' : ''}`}
        style={!fill && mapHeight ? { height: mapHeight } : undefined}
      >
        <div
          ref={mapRef}
          className="rounded-xl overflow-hidden border border-bg-border w-full h-full absolute inset-0 dashboard-map-fill"
        />
        <div className="pinit-map-top-gradient" />
        {live && (
          <span className="pinit-map-live-badge">
            <span className="pinit-map-live-dot" />
            Live
          </span>
        )}
        <div className="absolute bottom-2 left-2 right-2 z-[400] flex items-center justify-center gap-3 flex-wrap rounded-md bg-bg-card/90 backdrop-blur-sm border border-bg-border px-3 py-1.5 text-2xs text-gray-500 pointer-events-none">
          <span>{locationCount} location{locationCount !== 1 ? 's' : ''}</span>
          {presentActions.length > 0 ? (
            presentActions.map((action) => (
              <span key={action} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: ACTION_COLORS[action] }} />
                {actionLabel(action)}
              </span>
            ))
          ) : (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: DEFAULT_ACTION_COLOR }} />
              Live locations
            </span>
          )}
          <span className="opacity-40 text-[10px]">{leafletBasemapCredit()}</span>
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
