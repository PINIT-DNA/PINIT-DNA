import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';
import { attachShareCaptureGuards } from '../lib/share-capture-guards';
import {
  captureBestGps,
  captureQuickGps,
  isGeolocationPermissionDenied,
  type GpsCapture,
} from '../lib/precise-gps';
import { isValidMapCoordinate } from '../lib/geo-coords';

function getSessionId(): string {
  let sid = sessionStorage.getItem('pinit_session');
  if (!sid) {
    sid = Math.random().toString(36).slice(2);
    sessionStorage.setItem('pinit_session', sid);
  }
  return sid;
}

function computeDeviceFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    let canvasSig = '';
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(0, 0, 200, 40);
      ctx.fillStyle = '#fff';
      ctx.fillText(`PINIT-DNA-FP-${navigator.userAgent.slice(0, 20)}`, 2, 2);
      canvasSig = canvas.toDataURL();
    }
    const raw = [
      navigator.userAgent,
      navigator.language,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      String(navigator.hardwareConcurrency ?? ''),
      canvasSig,
    ].join('|');
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
    return `fp_${(h >>> 0).toString(16)}_${raw.length.toString(16)}`;
  } catch {
    return 'fp_unknown';
  }
}

function buildGpsPayload(gps: GpsCapture | null, requestLocation: boolean, locationAccepted: boolean) {
  if (gps && isValidMapCoordinate(gps.lat, gps.lng)) {
    return {
      gpsLat: gps.lat,
      gpsLng: gps.lng,
      gpsAccuracy: gps.accuracy,
      gpsCity: gps.city ?? gps.village,
      gpsTimestamp: gps.timestamp,
      gpsVillage: gps.village,
      gpsMandal: gps.mandal,
      gpsDistrict: gps.district,
      gpsState: gps.state,
      gpsPincode: gps.pincode,
      gpsFullAddress: gps.fullAddress,
      locationShared: true,
      locationSource: gps.locationSource === 'network' ? 'network' : 'gps',
    };
  }
  if (requestLocation && locationAccepted) return { locationShared: true, locationSource: 'ip' as const };
  if (requestLocation) return { locationShared: false, locationSource: 'denied' as const };
  return { locationShared: true, locationSource: 'ip' as const };
}

function locationGrantedLocally() {
  try { return localStorage.getItem('pinit_location_granted') === '1'; } catch { return false; }
}
function rememberLocationGrant() {
  try { localStorage.setItem('pinit_location_granted', '1'); } catch { /* ignore */ }
}

/** Guest living page: same view / GPS / scroll / capture / hop tracking as Share File. */
export function LivingPageGuestTracker({
  token,
  ready,
  onBlockedChange,
}: {
  token: string;
  ready: boolean;
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const [requestLocation, setRequestLocation] = useState(false);
  const [locationDone, setLocationDone] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [infoReady, setInfoReady] = useState(false);
  const gpsRef = useRef<GpsCapture | null>(null);
  const tracked = useRef(false);
  const hopRedirecting = useRef(false);
  const viewedSent = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void axios.get(`${API_BASE_URL}/share/${encodeURIComponent(token)}`).then(({ data }) => {
      if (cancelled) return;
      const link = (data as { link?: {
        requestLocation?: boolean;
        locationAlreadyShared?: boolean;
      } }).link;
      const needGps = Boolean(link?.requestLocation);
      setRequestLocation(needGps);
      if (!needGps || link?.locationAlreadyShared || locationGrantedLocally()) {
        if (needGps) rememberLocationGrant();
        setLocationDone(true);
        onBlockedChange?.(false);
      } else {
        onBlockedChange?.(true);
      }
      setInfoReady(true);
    }).catch(() => {
      if (!cancelled) {
        setLocationDone(true);
        setInfoReady(true);
        onBlockedChange?.(false);
      }
    });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!requestLocation || !locationDone) return;
    let cancelled = false;
    void captureBestGps({ targetAccuracyM: 45, maxWaitMs: 28_000, minSamples: 1 }).then((best) => {
      if (cancelled || !best) return;
      gpsRef.current = best;
      if (viewedSent.current) {
        void axios.post(`${API_BASE_URL}/share/${encodeURIComponent(token)}/access`, {
          action: 'LOCATION_UPDATE',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          sessionId: getSessionId(),
          screenResolution: `${screen.width}x${screen.height}`,
          deviceFingerprint: computeDeviceFingerprint(),
          ...buildGpsPayload(best, true, true),
        }).catch(() => {});
      }
    });
    return () => { cancelled = true; };
  }, [requestLocation, locationDone, token]);

  useEffect(() => {
    if (!ready || !infoReady || !locationDone || tracked.current) return;
    tracked.current = true;
    const accessUrl = `${API_BASE_URL}/share/${encodeURIComponent(token)}/access`;
    const sid = getSessionId();
    const fingerprint = computeDeviceFingerprint();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const screenRes = `${screen.width}x${screen.height}`;

    const post = (action: string, extra?: Record<string, string>) => {
      const body = JSON.stringify({
        action,
        timezone: tz,
        sessionId: sid,
        screenResolution: screenRes,
        deviceFingerprint: fingerprint,
        ...buildGpsPayload(gpsRef.current, requestLocation, locationDone),
        ...extra,
      });
      const send = () => fetch(accessUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'same-origin',
      }).then(async (res) => {
        if (!res.ok) return;
        const data = await res.json().catch(() => ({})) as { redirectToken?: string; grandchildToken?: string };
        const next = data.redirectToken || data.grandchildToken;
        if (action === 'VIEWED' && next && next !== token && !hopRedirecting.current) {
          hopRedirecting.current = true;
          window.location.replace(`/s/${encodeURIComponent(next)}/live`);
        }
      }).catch(() => undefined);
      if (document.hidden && typeof navigator.sendBeacon === 'function') {
        try {
          if (navigator.sendBeacon(accessUrl, new Blob([body], { type: 'application/json' }))) return;
        } catch { /* fall through */ }
      }
      void send();
    };

    post('VIEWED');
    viewedSent.current = true;

    const scrollMilestones = new Set<number>();
    const onScroll = () => {
      const denom = document.documentElement.scrollHeight - window.innerHeight;
      const pct = denom > 0 ? Math.round((window.scrollY / denom) * 100) : 100;
      for (const milestone of [10, 25, 50, 75, 100]) {
        if (pct >= milestone && !scrollMilestones.has(milestone)) {
          scrollMilestones.add(milestone);
          post('SCROLL', { scrollDepth: `${milestone}%` });
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const detach = attachShareCaptureGuards((action) => post(action));
    const onVisibility = () => {
      if (document.hidden) post('TAB_SWITCH');
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('scroll', onScroll);
      detach();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready, infoReady, locationDone, token, requestLocation]);

  const allowLocation = () => {
    if (!navigator.geolocation) {
      rememberLocationGrant();
      setLocationDone(true);
      onBlockedChange?.(false);
      return;
    }
    setAsking(true);
    const applyFix = (pos: GeolocationPosition) => {
      gpsRef.current = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: new Date(pos.timestamp).toISOString(),
        locationSource: pos.coords.accuracy <= 75 ? 'gps' : 'network',
      };
      rememberLocationGrant();
      setLocationDone(true);
      onBlockedChange?.(false);
      void captureQuickGps(20_000).then((quick) => {
        if (quick) gpsRef.current = quick;
      });
    };
    navigator.geolocation.getCurrentPosition(
      applyFix,
      (err) => {
        if (isGeolocationPermissionDenied(err)) {
          setAsking(false);
          setLocationDenied(true);
          return;
        }
        rememberLocationGrant();
        setLocationDone(true);
        onBlockedChange?.(false);
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  };

  if (!infoReady) return null;
  if (requestLocation && !locationDone) {
    return (
      <div className="rounded-xl border border-bg-border bg-bg-card p-5 mb-4 text-center">
        <p className="text-sm font-semibold text-white">Share your location to open this page</p>
        <p className="text-xs text-gray-500 mt-1">The owner asked to see where this living page is opened. Scroll, screenshots, and reshares are tracked the same way as a protected file.</p>
        {locationDenied && (
          <p className="text-xs text-red-400 mt-2">Location was blocked in the browser. Allow it for this site, then try again.</p>
        )}
        <button type="button" className="btn btn-primary btn-sm mt-4" onClick={allowLocation} disabled={asking}>
          {asking ? 'Locating…' : 'Allow location'}
        </button>
      </div>
    );
  }

  return null;
}
