/**
 * PINIT-DNA — Smart Link Secure Viewer
 * Route: /s/:token
 *
 * Public page — no auth required.
 * Recipient opens link → identity captured → file shown.
 * Tracks: VIEWED, DOWNLOADED events with IP/browser/geo.
 */

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Shield, Lock, Download, Eye, AlertTriangle, CheckCircle2, Clock, Ban, Share2, Copy } from 'lucide-react';
import axios from 'axios';
import { format } from 'date-fns';
import { API_BASE_URL } from '../config/api.config';
import { ClientReviewPanel } from '../components/share/ClientReviewPanel';
import { getShareReview } from '../services/share-review.api';
import type { ClientReviewContext } from '../services/share-review.api';
import { stripPinitProtectionTailsForDisplay } from '../lib/strip-pinit-tails';
import { isValidMapCoordinate } from '../lib/geo-coords';
import {
  captureBestGps,
  captureQuickGps,
  isGeolocationPermissionDenied,
  type GpsCapture,
} from '../lib/precise-gps';
import * as docxPreview from 'docx-preview';
import { formatTextAsDocument, DOCUMENT_STYLES } from '../utils/document-formatter';

interface LinkInfo {
  token:        string;
  filename:     string;
  mimeType:     string;
  note:         string | null;
  requireName:  boolean;
  allowDownload: boolean;
  expiresAt:    string | null;
  maxViews:     number | null;
  viewCount:    number;
  isExpired:    boolean;
  isExhausted:  boolean;
  isActive:     boolean;
  // ── Extended policy / verification flags (Smart Links upgrade) ───────────
  oneTimeUse?:     boolean;
  maxDownloads?:   number | null;
  downloadCount?:  number;
  requireOtp?:     boolean;
  otpVerified?:    boolean;
  signatureValid?: boolean;
  inactiveReason?: 'expired' | 'exhausted' | 'revoked' | 'one_time' | 'tampered' | null;
  viewerRevoked?: boolean;
  // ── Privacy & Location ──────────────────────────────────────────────────
  privacyMaskingEnabled?: boolean;
  requestLocation?:       boolean;
}

// Generate a session ID for grouping events
function getSessionId(): string {
  let sid = sessionStorage.getItem('pinit_session');
  if (!sid) { sid = Math.random().toString(36).slice(2); sessionStorage.setItem('pinit_session', sid); }
  return sid;
}

// ── Lightweight device fingerprint (canvas + nav signals → SHA-256-ish hash)
// Not a forensic-grade fingerprint (no WebGL/audio probing) — a fast, stable
// per-browser signature good enough to spot "same device, different session".
function computeDeviceFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 40;
    const ctx = canvas.getContext('2d');
    let canvasSig = '';
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(0, 0, 200, 40);
      ctx.fillStyle = '#fff';
      ctx.fillText('PINIT-DNA-FP-' + navigator.userAgent.slice(0, 20), 2, 2);
      canvasSig = canvas.toDataURL();
    }
    const raw = [
      navigator.userAgent, navigator.language,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      String(navigator.hardwareConcurrency ?? ''),
      canvasSig,
    ].join('|');

    // Simple deterministic 32-bit hash → hex (no crypto.subtle dependency,
    // works synchronously in all browsers including non-secure contexts)
    let h = 0;
    for (let i = 0; i < raw.length; i++) {
      h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
    }
    return 'fp_' + (h >>> 0).toString(16) + '_' + raw.length.toString(16);
  } catch {
    return 'fp_unknown';
  }
}

function getScreenResolution(): string {
  try { return `${screen.width}x${screen.height}`; } catch { return ''; }
}

function buildGpsPayload(
  gps: GpsCapture | null,
  requestLocation?: boolean,
  locationAccepted?: boolean,
) {
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
  // Owner required GPS and viewer allowed — IP geo until GPS arrives
  if (requestLocation && locationAccepted) {
    return { locationShared: true, locationSource: 'ip' as const };
  }
  if (requestLocation) return { locationShared: false, locationSource: 'denied' as const };
  // Owner did not require GPS — track via IP only
  return { locationShared: true, locationSource: 'ip' as const };
}

function shareTrackingHeaders() {
  return {
    'X-PINIT-Session': getSessionId(),
    'X-PINIT-Fingerprint': computeDeviceFingerprint(),
  };
}

/** Axios blob responses return JSON errors as Blob — parse for a readable message. */
async function extractApiError(err: unknown): Promise<string | undefined> {
  const ax = err as { response?: { data?: unknown } };
  const data = ax.response?.data;
  if (!data) return undefined;
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const msg = (data as { error?: unknown }).error;
    return typeof msg === 'string' ? msg : undefined;
  }
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text) as { error?: string };
      return typeof parsed.error === 'string' ? parsed.error : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function ShareViewerPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo]           = useState<LinkInfo | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [name, setName]           = useState('');
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [fileUrl, setFileUrl]     = useState('');
  const [downloading, setDownloading] = useState(false);
  const [fileLoadError, setFileLoadError] = useState<string | null>(null);
  const [shareFurtherUrl, setShareFurtherUrl] = useState<string | null>(null);
  const [shareFurtherBusy, setShareFurtherBusy] = useState(false);
  const [shareFurtherMsg, setShareFurtherMsg] = useState('');
  const hopRedirecting = useRef(false);

  // ── GPS Location (only when owner enabled requestLocation on the share) ───
  const [locationAsked, setLocationAsked] = useState(false);
  const [locationDone, setLocationDone] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [gpsData, setGpsData] = useState<GpsCapture | null>(null);
  const gpsDataRef = useRef<GpsCapture | null>(null);

  // ── Privacy Masking state ──────────────────────────────────────────────────
  const [maskedText, setMaskedText]           = useState<string | null>(null);
  const [isMasked, setIsMasked]               = useState(false);
  const [unmaskStatus, setUnmaskStatus]       = useState<'NONE'|'PENDING'|'APPROVED'|'REJECTED'>('NONE');
  const [unmaskRequesting, setUnmaskRequesting] = useState(false);
  const [_unmaskRequestId, setUnmaskRequestId] = useState<string | null>(null);

  useEffect(() => { gpsDataRef.current = gpsData; }, [gpsData]);

  const hasTracked = useRef(false);
  const [trackingReady, setTrackingReady] = useState(false);
  const [isIdleBlur, setIsIdleBlur] = useState(false);   // blur overlay on inactivity
  const nameRef = useRef('');
  useEffect(() => { nameRef.current = name; }, [name]);
  const viewedSentRef = useRef(false);

  // ── OTP / email-verification gate state ───────────────────────────────────
  const [otp, setOtp]               = useState('');
  const [otpError, setOtpError]     = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpVerifiedLocal, setOtpVerifiedLocal] = useState(false);

  const submitOtp = async () => {
    if (!token || !otp.trim()) return;
    setOtpVerifying(true);
    setOtpError('');
    try {
      await axios.post(`${API_BASE_URL}/share/${token}/verify-otp`, { otp: otp.trim() });
      setOtpVerifiedLocal(true);
      // Refresh link info so `info.otpVerified` reflects server state
      const { data } = await axios.get(`${API_BASE_URL}/share/${token}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setInfo((data as any).link);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setOtpError((err as any)?.response?.data?.error ?? 'Verification failed. Please try again.');
    } finally {
      setOtpVerifying(false);
    }
  };

  // ── Load link info ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const sid = getSessionId();
    const fingerprint = computeDeviceFingerprint();
    axios.get(`${API_BASE_URL}/share/${token}`, {
      headers: {
        'x-pinit-session': sid,
        'x-pinit-fingerprint': fingerprint,
      },
    })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }) => setInfo((data as any).link))
      .catch((err) => {
        const status = (err as { response?: { status?: number; data?: { error?: string; code?: string } } })?.response?.status;
        const apiErr = (err as { response?: { data?: { error?: string; code?: string } } })?.response?.data;
        if (status === 503 || apiErr?.code === 'BACKEND_OFFLINE') {
          setError('Backend is starting. Wait a few seconds and refresh.');
        } else if (status === 404) {
          setError('Link not found or has been removed. Check the full URL (token letters are case-sensitive).');
        } else {
          setError(apiErr?.error || 'Could not open this link. Is the backend running on port 4000?');
        }
      })
      .then(() => setLoading(false), () => setLoading(false));
  }, [token]);

  // When GPS not required, mark location gate complete immediately
  useEffect(() => {
    if (info && !info.requestLocation && !locationDone) {
      setLocationDone(true);
    }
  }, [info, locationDone]);

  // Background GPS refine — after Allow, or when GPS not required (best-effort, no gate)
  useEffect(() => {
    if (!info) return;
    if (info.requestLocation && !locationDone) return;
    let cancelled = false;
    void (async () => {
      // Only run browser GPS when owner required it (after Allow)
      if (!info.requestLocation) return;
      const best = await captureBestGps({ targetAccuracyM: 45, maxWaitMs: 28_000, minSamples: 1 });
      if (cancelled || !best) return;
      setGpsData((prev) => {
        if (prev && prev.accuracy <= best.accuracy) return prev;
        return best;
      });
    })();
    return () => { cancelled = true; };
  }, [info?.requestLocation, locationDone, info]);

  useEffect(() => {
    if (!viewedSentRef.current || !token || !gpsData) return;
    if (gpsData.accuracy > 75) return;
    void axios.post(`${API_BASE_URL}/share/${token}/access`, {
      action: 'LOCATION_UPDATE',
      recipientName: nameRef.current || undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sessionId: getSessionId(),
      screenResolution: getScreenResolution(),
      deviceFingerprint: computeDeviceFingerprint(),
      ...buildGpsPayload(gpsData, info?.requestLocation, locationDone),
    }).catch(() => {});
  }, [gpsData?.lat, gpsData?.lng, gpsData?.accuracy, token, info?.requestLocation, locationDone]);

  // ── Decide once that tracking can start (info loaded, name gate passed,
  //    link active at the moment of arrival). This flag is a one-way switch:
  //    once true it never flips back to false, so the listener-attachment
  //    effect below never tears down its handlers mid-session (which was the
  //    bug — `info` mutating later, e.g. viewCount incrementing and isActive
  //    flipping false, was re-running the effect, running its cleanup, and
  //    then bailing out early without re-attaching anything). ───────────────
  useEffect(() => {
    if (trackingReady || !info) return;
    if (info.requireName && !nameSubmitted) return;
    if (info.requireOtp && !info.otpVerified && !otpVerifiedLocal) return;
    if (!info.isActive) return;
    if (info.requestLocation && !locationDone) return;
    setTrackingReady(true);
  }, [info, nameSubmitted, otpVerifiedLocal, trackingReady, locationDone]);

  // ── Attach all behavioral tracking listeners (runs exactly once) ──────────
  useEffect(() => {
    if (!trackingReady || hasTracked.current) return;
    hasTracked.current = true;

    const sid = getSessionId();
    const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const screenRes = getScreenResolution();
    const fingerprint = computeDeviceFingerprint();

    const track = (action: string, extra?: Record<string, string>) => {
      const gps = gpsDataRef.current;
      return axios.post(`${API_BASE_URL}/share/${token}/access`, {
        action, recipientName: nameRef.current || undefined,
        timezone: tz, sessionId: sid,
        screenResolution: screenRes, deviceFingerprint: fingerprint,
        ...buildGpsPayload(gps, info?.requestLocation, locationDone || !info?.requestLocation),
        ...extra,
      }).then((res) => {
        const data = res.data as { redirectToken?: string; grandchildToken?: string };
        const next = data.redirectToken || data.grandchildToken;
        // New person opened this URL → server minted a hop link; move them onto it
        // so their timeline stays separate from the previous recipient.
        if (
          action === 'VIEWED' &&
          next &&
          token &&
          next !== token &&
          !hopRedirecting.current
        ) {
          hopRedirecting.current = true;
          try {
            sessionStorage.setItem('pinit_hop_from', token);
            sessionStorage.setItem('pinit_hop_to', next);
          } catch { /* ignore */ }
          window.location.replace(`/s/${next}`);
        }
        return res;
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[SmartLink] track failed', action, err?.message);
      });
    };

    // Wait for the best GPS we can get before VIEWED so Access Intelligence shows
    // village-level fix — shorter wait after hop redirect so forwards still register.
    const sendViewed = () => {
      viewedSentRef.current = true;
      void track('VIEWED');
    };
    let isHopLanding = false;
    try {
      const hopTo = sessionStorage.getItem('pinit_hop_to');
      if (hopTo && token && hopTo === token) {
        isHopLanding = true;
        sessionStorage.removeItem('pinit_hop_to');
        sessionStorage.removeItem('pinit_hop_from');
      }
    } catch { /* ignore */ }
    const wantsPreciseGps = Boolean(info?.requestLocation);
    if (!wantsPreciseGps) {
      sendViewed();
    } else {
      const GPS_WAIT_MS = isHopLanding ? 2_000 : 3_000;
      const GOOD_ACCURACY_M = 60;
      if (gpsDataRef.current && gpsDataRef.current.accuracy <= GOOD_ACCURACY_M) {
        sendViewed();
      } else {
        const gpsWait = setTimeout(sendViewed, GPS_WAIT_MS);
        const gpsCheck = setInterval(() => {
          const g = gpsDataRef.current;
          if (g && g.accuracy <= GOOD_ACCURACY_M) {
            clearInterval(gpsCheck);
            clearTimeout(gpsWait);
            sendViewed();
          }
        }, 400);
        setTimeout(() => clearInterval(gpsCheck), GPS_WAIT_MS + 300);
      }
    }

    // ── Mouse activity / idle detection ───────────────────────────────────
    // Fires IDLE once after 60s of no mouse/keyboard/scroll activity, and
    // ACTIVE again when the user resumes — gives a coarse "engaged vs.
    // walked-away" signal without continuous mouse-position streaming
    // (which would flood the audit log for no real benefit).
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let isIdle = false;
    const IDLE_MS = 60_000;
    const resetIdle = () => {
      if (isIdle) {
        isIdle = false;
        setIsIdleBlur(false);   // remove blur overlay
        track('ACTIVE');
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        isIdle = true;
        setIsIdleBlur(true);    // show blur overlay after 60s inactivity
        track('IDLE');
      }, IDLE_MS);
    };
    resetIdle();
    const activityEvents: Array<keyof DocumentEventMap> = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
    for (const evt of activityEvents) document.addEventListener(evt, resetIdle, { passive: true });

    // ── Scroll depth tracking ─────────────────────────────────────────────
    const scrollMilestones = new Set<number>();
    const onScroll = () => {
      const denom = document.documentElement.scrollHeight - window.innerHeight;
      const pct = denom > 0
        ? Math.round((window.scrollY / denom) * 100)
        : 100;
      for (const milestone of [10, 25, 50, 75, 100]) {
        if (pct >= milestone && !scrollMilestones.has(milestone)) {
          scrollMilestones.add(milestone);
          track('SCROLL', { scrollDepth: `${milestone}%` });
        }
      }
      // Also fire once if user scrolled at all (denom=0 means page fits screen — mark as 100% read)
      if (denom === 0 && !scrollMilestones.has(100)) {
        scrollMilestones.add(100);
        track('SCROLL', { scrollDepth: '100%' });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // ── Copy attempt detection ─────────────────────────────────────────────
    // The 'copy' DOM event only fires when there's an active selection to
    // copy — and the viewer intentionally sets `user-select: none`, so it
    // may never fire. Detect the keyboard shortcut directly as the primary
    // signal, and also keep the native 'copy' event as a backup.
    const onCopy = () => track('COPY_ATTEMPT');
    document.addEventListener('copy', onCopy);

    // ── Keyboard-based detection: copy, screenshot, devtools ──────────────
    const copyCooldown = { last: 0 };
    const screenshotCooldown = { last: 0 };
    const onKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const key = e.key?.toLowerCase?.() ?? '';

      // Ctrl+C / Cmd+C — copy shortcut
      const isCopyShortcut = (e.ctrlKey || e.metaKey) && key === 'c';
      if (isCopyShortcut && now - copyCooldown.last > 1000) {
        copyCooldown.last = now;
        track('COPY_ATTEMPT');
      }

      // Screenshot shortcuts ONLY — an actual screen-capture key combination.
      //
      // Deliberately NOT treated as screenshots (they were, and produced false
      // "screenshot attempt" entries against viewers who never took one):
      //   F12 / Ctrl+Shift+I  → DevTools, a different action entirely
      //   Ctrl+Shift+S        → not a Windows capture shortcut (that is Win+Shift+S,
      //                         which arrives as metaKey+shift+s and is matched below)
      const isScreenshot =
        e.key === 'PrintScreen' ||
        (e.metaKey && e.shiftKey && ['3', '4', '5', 's'].includes(key)) || // Mac Cmd+Shift+3/4/5, Win+Shift+S
        (e.metaKey && key === 'printscreen');                              // Win+PrtScn
      if (isScreenshot && now - screenshotCooldown.last > 1000) {
        screenshotCooldown.last = now;
        track('SCREENSHOT_ATTEMPT');
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // PrintScreen frequently only emits a `keyup` event (no keydown) on
    // Windows — listen there too as a fallback.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        const now = Date.now();
        if (now - screenshotCooldown.last > 1000) {
          screenshotCooldown.last = now;
          track('SCREENSHOT_ATTEMPT');
        }
      }
    };
    document.addEventListener('keyup', onKeyUp);

    // ── Tab switch / visibility change ────────────────────────────────────
    const onVisibility = () => {
      if (document.hidden) track('TAB_SWITCH');
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ── Removed: the "brief window blur = OS screenshot" heuristic.
    //
    // A sub-100ms blur/focus cycle is produced by far more than screen capture:
    // alt-tabbing, a notification toast stealing focus, clicking browser chrome,
    // an OS dialog, even normal focus churn. It cannot distinguish those from a
    // screenshot, so it reported SCREENSHOT_ATTEMPT against viewers who never
    // took one — and those false hits then fed "multiple suspicious attempts"
    // and "high event velocity", inflating the risk score off a single bad signal.
    //
    // Only real capture keystrokes are recorded now (see isScreenshot above).
    // Genuine OS-level captures that emit no key event are simply not detectable
    // from a web page; claiming otherwise is worse than not reporting it.

    // ── Print detection ───────────────────────────────────────────────────
    // `beforeprint` doesn't fire reliably in every browser for Ctrl+P —
    // also hook matchMedia('print') as a cross-browser fallback.
    const onPrint = () => track('PRINT_ATTEMPT');
    window.addEventListener('beforeprint', onPrint);

    let mql: MediaQueryList | null = null;
    const onPrintMql = (e: MediaQueryListEvent) => { if (e.matches) track('PRINT_ATTEMPT'); };
    try {
      mql = window.matchMedia('print');
      mql.addEventListener?.('change', onPrintMql);
    } catch { /* not supported — ignore */ }

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeprint', onPrint);
      mql?.removeEventListener?.('change', onPrintMql);
      if (idleTimer) clearTimeout(idleTimer);
      for (const evt of activityEvents) document.removeEventListener(evt, resetIdle);
    };
  }, [trackingReady, token]);

  // ── Download handler ───────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (!info?.allowDownload || !token) return;
    setDownloading(true);
    try {
      const resp = await axios.get<Blob>(`${API_BASE_URL}/share/${token}/file`, {
        responseType: 'blob',
        headers: shareTrackingHeaders(),
      });
      const url = URL.createObjectURL(resp.data);
      const a   = document.createElement('a');
      a.href = url; a.download = info.filename; a.click();
      URL.revokeObjectURL(url);

      // Track download
      await axios.post(`${API_BASE_URL}/share/${token}/access`, {
        action: 'DOWNLOADED', recipientName: name || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        sessionId: getSessionId(),
        screenResolution: getScreenResolution(),
        deviceFingerprint: computeDeviceFingerprint(),
        ...buildGpsPayload(gpsDataRef.current, info?.requestLocation, locationDone || !info?.requestLocation),
      }).catch(() => {});
    } catch {
      alert('Download failed. The file may have been removed.');
    } finally { setDownloading(false); }
  };

  /** Mint a NEW tracked hop URL for the next person (WhatsApp / email). */
  const handleShareFurther = async () => {
    if (!token || shareFurtherBusy) return;
    setShareFurtherBusy(true);
    setShareFurtherMsg('');
    try {
      const { data } = await axios.post(`${API_BASE_URL}/share/${token}/share-further`, {
        recipientLabel: name.trim() ? `Shared by ${name.trim()}` : undefined,
        forwardedByLabel: name.trim() || undefined,
      });
      const url = (data as { url?: string }).url;
      if (!url) throw new Error('No hop URL returned');
      setShareFurtherUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setShareFurtherMsg('New tracked link copied — send this to the next person (not the old link).');
      } catch {
        setShareFurtherMsg('New tracked link ready — copy it below and send it.');
      }
    } catch {
      setShareFurtherMsg('Could not create a new hop link. Try again.');
    } finally {
      setShareFurtherBusy(false);
    }
  };

  // ── Text/CSV/JSON content state — must be declared before any conditional returns ──
  const [textContent, setTextContent] = useState<string | null>(null);

  // ── Load file for inline view ──────────────────────────────────────────────
  const fileBlobRef    = useRef<Blob | null>(null);
  const fileLoadedRef  = useRef(false);   // prevents re-fetch when info updates
  useEffect(() => {
    if (!info?.isActive) return;
    if (info.requireName && !nameSubmitted) return;
    if (fileLoadedRef.current) return;   // already loaded — don't re-fetch on info updates
    fileLoadedRef.current = true;
    axios.get<Blob>(`${API_BASE_URL}/share/${token}/file`, {
      responseType: 'blob',
      headers: shareTrackingHeaders(),
    })
      .then(({ data }) => {
        fileBlobRef.current = data;
        const url = URL.createObjectURL(data);
        setFileLoadError(null);
        setFileUrl(url);
      })
      .catch(async (err) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const status = (err as any)?.response?.status;
        const msg    = await extractApiError(err);
        if (status === 403) {
          setFileLoadError(msg ?? 'Access denied: your country, device, or IP is not permitted by the sender\'s policy.');
        } else if (status === 410) {
          setFileLoadError(msg ?? 'This link has been revoked or has reached its download limit.');
        } else if (status === 503) {
          setFileLoadError(msg ?? 'The file could not be loaded from vault storage. The server may need configuration.');
        } else {
          setFileLoadError(msg ?? 'Failed to load the file. The server may be unreachable.');
        }
      });
  }, [info, nameSubmitted, token]);

  // ── Review mode (Collaboration Phase 2) ────────────────────────────────
  // Returns null for every ordinary share link, so the viewer is unchanged for
  // the 12 links that already exist. Failure is deliberately silent: a review
  // panel that cannot load must never block someone from reading their file.
  const [review, setReview] = useState<ClientReviewContext | null>(null);
  const [reviewNonce, setReviewNonce] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getShareReview(token)
      .then((r) => { if (!cancelled) setReview(r); })
      .catch(() => { if (!cancelled) setReview(null); });
    return () => { cancelled = true; };
  }, [token, reviewNonce]);

  // ── Load text content when it's a text/csv/json file (not HTML — rendered in iframe) ─
  useEffect(() => {
    const mt = info?.mimeType ?? '';
    const fn = info?.filename?.toLowerCase() ?? '';
    const isHtmlFile = mt === 'text/html' || mt === 'application/xhtml+xml'
      || ['.html', '.htm', '.xhtml'].some((e) => fn.endsWith(e));
    const isTextFile = !isHtmlFile && (
      mt === 'text/plain' || mt === 'text/csv' || mt === 'application/json'
      || ['.txt', '.csv', '.json', '.md', '.log'].some((e) => fn.endsWith(e))
    );
    if (!fileUrl || !isTextFile || !fileBlobRef.current) return;
    fileBlobRef.current.text().then((t) => setTextContent(t)).catch(() => {});
  }, [fileUrl, info]);

  // ── HTML preview URL (force text/html so browser renders the page) ─────────
  const [htmlPreviewUrl, setHtmlPreviewUrl] = useState('');
  useEffect(() => {
    const mt = info?.mimeType ?? '';
    const fn = info?.filename?.toLowerCase() ?? '';
    const isHtmlFile = mt === 'text/html' || mt === 'application/xhtml+xml'
      || ['.html', '.htm', '.xhtml'].some((e) => fn.endsWith(e));
    if (!fileUrl || !isHtmlFile || !fileBlobRef.current) {
      setHtmlPreviewUrl('');
      return;
    }
    let cancelled = false;
    void fileBlobRef.current.text().then((raw) => {
      if (cancelled) return;
      const cleaned = stripPinitProtectionTailsForDisplay(raw);
      const blob = new Blob([cleaned], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      setHtmlPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fileUrl, info]);

  useEffect(() => {
    return () => {
      if (htmlPreviewUrl) URL.revokeObjectURL(htmlPreviewUrl);
    };
  }, [htmlPreviewUrl]);

  // ── Privacy Masking: load masked text when masking is enabled ─────────────
  useEffect(() => {
    if (!info?.privacyMaskingEnabled || !info.isActive) return;
    if (info.requireName && !nameSubmitted) return;
    const sid = getSessionId();
    axios.get(`${API_BASE_URL}/share/${token}/masked-text?sessionId=${sid}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: { data: any }) => {
        setMaskedText(data.text ?? '');
        setIsMasked(!data.isUnmasked);
      })
      .catch(() => setMaskedText(''));
  }, [info, nameSubmitted, token]);

  // ── Privacy Masking: poll unmask request status every 5s ──────────────────
  useEffect(() => {
    if (!info?.privacyMaskingEnabled) return;
    if (unmaskStatus === 'APPROVED') return;
    const sid = getSessionId();
    const interval = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API_BASE_URL}/share/${token}/unmask-status?sessionId=${sid}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (data as any).status as string;
        if (s === 'APPROVED' || s === 'REJECTED') {
          setUnmaskStatus(s as 'APPROVED' | 'REJECTED');
          clearInterval(interval);
          if (s === 'APPROVED') {
            // Reload masked text (now unmasked)
            const { data: d } = await axios.get(`${API_BASE_URL}/share/${token}/masked-text?sessionId=${sid}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setMaskedText((d as any).text ?? '');
            setIsMasked(false);
          }
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [info, token, unmaskStatus]);

  // ── Privacy Masking: request unmasked access ───────────────────────────────
  const handleRequestUnmask = async () => {
    if (unmaskRequesting) return;
    setUnmaskRequesting(true);
    try {
      const sid = getSessionId();
      const { data } = await axios.post(`${API_BASE_URL}/share/${token}/unmask-request`, {
        recipientName: name || undefined,
        sessionId: sid,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setUnmaskRequestId((data as any).requestId);
      setUnmaskStatus('PENDING');
    } catch { /* ignore */ }
    finally { setUnmaskRequesting(false); }
  };



  // ── Render DOCX inline using docx-preview ─────────────────────────────────
  const docxContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mimeType = info?.mimeType ?? '';
    const filename = info?.filename ?? '';
    const isDocxFile = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || filename.toLowerCase().endsWith('.docx');
    if (!fileUrl || !isDocxFile || !docxContainerRef.current || !fileBlobRef.current) return;
    const container = docxContainerRef.current;
    container.innerHTML = '';
    docxPreview.renderAsync(fileBlobRef.current, container, undefined, {
      className: 'docx-viewer',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
    }).catch(() => {});
  }, [fileUrl]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-dna-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400 text-sm">Verifying secure link…</p>
      </div>
    </div>
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !info) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-center max-w-sm mx-auto p-6">
        <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={28} className="text-danger" />
        </div>
        <h1 className="text-white font-bold text-lg mb-2">Link Not Found</h1>
        <p className="text-gray-400 text-sm">{error || 'This link does not exist or has been removed.'}</p>
      </div>
    </div>
  );

  // ── Per-viewer revoke (owner blocked this device only) ─────────────────────
  if (info.viewerRevoked) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-center max-w-sm mx-auto p-6">
        <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Ban size={28} className="text-danger" />
        </div>
        <h1 className="text-white font-bold text-lg mb-2">Access Revoked</h1>
        <p className="text-gray-400 text-sm">
          The owner has revoked your access to this file. Other recipients are not affected.
        </p>
        <div className="mt-4 px-4 py-2 bg-bg-elevated rounded-lg border border-bg-border inline-block">
          <p className="text-2xs text-gray-500 mono">{token}</p>
        </div>
      </div>
    </div>
  );

  // ── Expired / exhausted / revoked ────────────────────────────────────────────
  if (!info.isActive) {
    const reason = info.inactiveReason
      ?? (info.isExpired ? 'expired' : info.isExhausted ? 'exhausted' : 'revoked');
    const title = reason === 'expired' ? 'Link Expired'
      : reason === 'exhausted' ? 'View Limit Reached'
      : reason === 'one_time' ? 'Link Already Used'
      : reason === 'tampered' ? 'Link Invalid'
      : 'Link Unavailable';
    const message = reason === 'expired'
      ? 'This share link has expired and is no longer accessible.'
      : reason === 'exhausted'
      ? `This link was limited to ${info.maxViews ?? '?'} views and has been exhausted.`
      : reason === 'one_time'
      ? 'This was a one-time link and has already been used.'
      : reason === 'tampered'
      ? 'This link could not be verified and may have been tampered with.'
      : 'This share link has been revoked or is no longer active.';
    return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-center max-w-sm mx-auto p-6">
        <div className="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Ban size={28} className="text-warning" />
        </div>
        <h1 className="text-white font-bold text-lg mb-2">{title}</h1>
        <p className="text-gray-400 text-sm">{message}</p>
        <div className="mt-4 px-4 py-2 bg-bg-elevated rounded-lg border border-bg-border inline-block">
          <p className="text-2xs text-gray-500 mono">{token}</p>
        </div>
      </div>
    </div>
    );
  }

  // ── Name gate ──────────────────────────────────────────────────────────────
  if (info.requireName && !nameSubmitted) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="max-w-sm w-full mx-auto p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-dna-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-dna-400" />
          </div>
          <h1 className="text-white font-bold text-lg">PINIT-DNA Secure File</h1>
          <p className="text-gray-400 text-sm mt-1">{info.filename}</p>
        </div>
        <div className="card space-y-4">
          <p className="text-sm text-gray-300">Please enter your name to access this document:</p>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Your full name"
            className="input w-full"
            onKeyDown={e => e.key === 'Enter' && name.trim() && setNameSubmitted(true)}
          />
          <button
            onClick={() => setNameSubmitted(true)} disabled={!name.trim()}
            className="btn btn-primary w-full"
          >
            <Eye size={15} /> Access Document
          </button>
        </div>
      </div>
    </div>
  );

  // ── OTP / identity verification gate ───────────────────────────────────────
  if (info.requireOtp && !info.otpVerified && !otpVerifiedLocal) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="max-w-sm w-full mx-auto p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-dna-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-dna-400" />
          </div>
          <h1 className="text-white font-bold text-lg">Verify Your Identity</h1>
          <p className="text-gray-400 text-sm mt-1">
            Enter the 6-digit verification code sent to you to access "{info.filename}"
          </p>
        </div>
        <div className="card space-y-4">
          <input
            type="text" inputMode="numeric" maxLength={6} value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className="input w-full text-center tracking-[0.5em] text-lg font-mono"
            onKeyDown={e => e.key === 'Enter' && otp.trim().length === 6 && !otpVerifying && submitOtp()}
          />
          {otpError && <p className="text-sm text-red-400">{otpError}</p>}
          <button
            onClick={submitOtp} disabled={otp.trim().length !== 6 || otpVerifying}
            className="btn btn-primary w-full"
          >
            {otpVerifying ? 'Verifying…' : <><Shield size={15} /> Verify Code</>}
          </button>
          <p className="text-xs text-gray-500 text-center">
            Didn't receive a code? Contact the person who shared this link with you.
          </p>
        </div>
      </div>
    </div>
  );

  // ── GPS Location Permission Gate (Chrome-style compact prompt) ─────────────
  if (info.requestLocation && !locationDone) {
    const handleAllow = () => {
      if (!navigator.geolocation) {
        setLocationDone(true);
        return;
      }
      setLocationAsked(true);
      setLocationDenied(false);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          setGpsData({
            lat,
            lng,
            accuracy,
            timestamp: new Date(pos.timestamp).toISOString(),
            locationSource: accuracy <= 75 ? 'gps' : 'network',
          });
          setLocationDone(true);
          void captureQuickGps(8_000).then((quick) => {
            if (quick) setGpsData(quick);
          });
        },
        (err) => {
          if (isGeolocationPermissionDenied(err)) {
            setLocationAsked(false);
            setLocationDenied(true);
            return;
          }
          // Timeout / unavailable — still open; IP geo on server
          setLocationDone(true);
        },
        { enableHighAccuracy: true, maximumAge: 120_000, timeout: 3_500 },
      );
    };

    const hostLabel = typeof window !== 'undefined' ? window.location.host : 'this site';

    return (
      <div className="min-h-screen bg-[#f1f3f4] relative overflow-hidden">
        {/* Soft page behind prompt (like a blank tab) */}
        <div className="absolute inset-0 flex flex-col items-center pt-28 px-4 opacity-40 pointer-events-none select-none">
          <div className="w-10 h-10 rounded-xl bg-violet-600/20 mb-3" />
          <div className="h-3 w-40 bg-slate-300 rounded mb-2" />
          <div className="h-2 w-56 bg-slate-200 rounded" />
        </div>

        {/* Chrome-like permission bubble — top center */}
        <div className="relative z-10 flex justify-center pt-3 px-3 sm:pt-4 sm:justify-start sm:pl-4">
          <div
            className="w-full max-w-[360px] rounded-lg bg-white shadow-[0_1px_3px_rgba(60,64,67,0.3),0_4px_8px_3px_rgba(60,64,67,0.15)] border border-black/[0.08]"
            role="dialog"
            aria-labelledby="loc-perm-title"
            aria-describedby="loc-perm-desc"
          >
            <div className="px-4 pt-3.5 pb-2 flex gap-3">
              <div className="w-5 h-5 mt-0.5 rounded-full bg-[#1a73e8] flex items-center justify-center shrink-0 text-white text-[10px] font-bold">
                P
              </div>
              <div className="min-w-0">
                <p id="loc-perm-title" className="text-[13px] leading-snug text-[#202124] font-medium">
                  <span className="font-normal text-[#5f6368]">{hostLabel}</span>
                  {' '}wants to
                </p>
                <p id="loc-perm-desc" className="text-[13px] leading-snug text-[#202124] mt-0.5">
                  Know your location
                </p>
                {locationDenied && (
                  <p className="text-[11px] text-[#d93025] mt-2 leading-snug">
                    Location was blocked. Allow it in the address bar, then try again.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-1 px-2 pb-2 pt-1">
              <button
                type="button"
                disabled={locationAsked}
                onClick={() => {
                  setLocationDenied(true);
                  setLocationAsked(false);
                }}
                className="min-w-[64px] h-9 px-3 rounded text-[13px] font-medium text-[#1a73e8] hover:bg-[#f1f3f4] disabled:opacity-50"
              >
                Block
              </button>
              <button
                type="button"
                disabled={locationAsked}
                onClick={handleAllow}
                className="min-w-[64px] h-9 px-3 rounded text-[13px] font-medium text-[#1a73e8] hover:bg-[#f1f3f4] disabled:opacity-50"
              >
                {locationAsked ? '…' : 'Allow'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Secure Viewer — file-type classification ───────────────────────────────
  const mime     = info?.mimeType ?? '';
  const filename = info?.filename?.toLowerCase() ?? '';
  const isImage  = mime.startsWith('image/');
  const isPDF    = mime === 'application/pdf';
  const isDocx   = mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                   || filename.endsWith('.docx');
  const isVideo  = mime.startsWith('video/') || ['.mp4','.webm','.mov','.avi','.mkv'].some(e => filename.endsWith(e));
  const isAudio  = mime.startsWith('audio/') || ['.mp3','.wav','.ogg','.flac','.aac','.m4a'].some(e => filename.endsWith(e));
  const isHtml   = mime === 'text/html' || mime === 'application/xhtml+xml'
                   || ['.html', '.htm', '.xhtml'].some((e) => filename.endsWith(e));
  const isText   = !isHtml && (
                   mime === 'text/plain' || mime === 'text/csv' || mime === 'application/json'
                   || ['.txt','.csv','.json','.md','.log'].some(e => filename.endsWith(e))
                 );

  return (
    <div className="min-h-screen bg-bg-base flex flex-col"
      onContextMenu={e => e.preventDefault()}  // Block right-click
    >
      {/* ── Print-hide style: hides content from browser print dialog ────── */}
      <style>{`@media print { .print-hide { display: none !important; } }`}</style>

      {/* ── Idle blur overlay — shown after 60s of no activity ─────────────
           Clicking anywhere dismisses it (resetIdle fires via document listener) */}
      {isIdleBlur && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', background: 'rgba(15,23,42,0.55)' }}
        >
          <div className="text-center">
            <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock size={28} className="text-white" />
            </div>
            <p className="text-white font-bold text-lg mb-1">Session Paused</p>
            <p className="text-white/60 text-sm">Move your mouse or press any key to resume</p>
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="bg-bg-card border-b border-bg-border px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-dna-500/20 rounded-lg flex items-center justify-center">
            <Lock size={13} className="text-dna-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white truncate max-w-[200px]">{info.filename}</p>
            <p className="text-2xs text-gray-500">PINIT-DNA Secure Viewer</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Expiry */}
          {info.expiresAt && (
            <div className="flex items-center gap-1 text-2xs text-gray-500 border border-bg-border rounded px-2 py-1">
              <Clock size={10} />
              Expires {format(new Date(info.expiresAt), 'MMM d')}
            </div>
          )}
          {/* Max views */}
          {info.maxViews && (
            <div className="flex items-center gap-1 text-2xs text-gray-500 border border-bg-border rounded px-2 py-1">
              <Eye size={10} />
              {info.viewCount}/{info.maxViews} views
            </div>
          )}
          {/* Verified badge */}
          <div className="flex items-center gap-1 text-2xs text-success border border-success/30 bg-success/5 rounded px-2 py-1">
            <CheckCircle2 size={10} />
            Verified
          </div>
          {/* Share further — mint a NEW hop URL for the next recipient */}
          <button
            type="button"
            onClick={handleShareFurther}
            disabled={shareFurtherBusy}
            className="btn btn-secondary btn-sm text-xs"
            title="Create a new tracked link to send to someone else"
          >
            <Share2 size={12} />
            {shareFurtherBusy ? 'Creating…' : 'Share further'}
          </button>
          {/* Download button */}
          {info.allowDownload && (
            <button onClick={handleDownload} disabled={downloading}
              className="btn btn-secondary btn-sm text-xs">
              <Download size={12} />
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          )}
        </div>
      </div>

      {/* Note from sender */}
      {info.note && (
        <div className="bg-dna-500/5 border-b border-dna-500/20 px-4 py-2">
          <p className="text-xs text-dna-300">📝 {info.note}</p>
        </div>
      )}

      {(shareFurtherUrl || shareFurtherMsg) && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-3 space-y-2">
          {shareFurtherMsg && (
            <p className="text-xs text-amber-200">{shareFurtherMsg}</p>
          )}
          {shareFurtherUrl && (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-2xs text-white/90 bg-black/30 rounded px-2 py-1.5 truncate">
                {shareFurtherUrl}
              </code>
              <button
                type="button"
                className="btn btn-secondary btn-sm text-xs shrink-0"
                onClick={() => {
                  void navigator.clipboard.writeText(shareFurtherUrl);
                  setShareFurtherMsg('Copied again — send this NEW link only.');
                }}
              >
                <Copy size={12} /> Copy
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Privacy Masking banner (shown when masking is active) ──────────── */}
      {info.privacyMaskingEnabled && (
        <div className={`px-4 py-2.5 flex items-center gap-3 text-xs font-medium border-b ${isMasked ? 'bg-purple-600/20 border-purple-400/50' : 'bg-green-600/20 border-green-400/50'}`}>
          <span className="text-base">{isMasked ? '🔏' : '🔓'}</span>
          <span className={`font-semibold ${isMasked ? 'text-purple-200' : 'text-green-200'}`}>
            {isMasked
              ? 'Privacy Masking is active — some sensitive data is hidden.'
              : 'Unmasked access granted — full document is visible.'}
          </span>
          {isMasked && unmaskStatus === 'NONE' && (
            <button onClick={handleRequestUnmask} disabled={unmaskRequesting}
              className="ml-auto px-3 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-600 disabled:opacity-60 text-white font-semibold text-xs border border-purple-400 transition-colors">
              {unmaskRequesting ? 'Requesting…' : '🔑 Request Unmasked Access'}
            </button>
          )}
          {isMasked && unmaskStatus === 'PENDING' && (
            <span className="ml-auto px-3 py-1.5 rounded-lg bg-yellow-500/20 border border-yellow-400/60 text-yellow-200 font-semibold text-xs animate-pulse">⏳ Awaiting owner approval…</span>
          )}
          {isMasked && unmaskStatus === 'REJECTED' && (
            <span className="ml-auto px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-400/60 text-red-200 font-semibold text-xs">❌ Access request rejected</span>
          )}
        </div>
      )}

      {/* File viewer area — print-hide hides content from browser print dialog */}
      <div className="print-hide flex-1 flex items-start justify-center p-4 overflow-auto"
        style={{ userSelect: 'none', position: 'relative' }}
      >
        {fileLoadError ? (
          <div className="mt-20 max-w-sm mx-auto text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Ban size={28} className="text-red-400" />
            </div>
            <h2 className="text-white font-bold text-lg mb-2">Access Blocked</h2>
            <p className="text-gray-400 text-sm">{fileLoadError}</p>
            <p className="text-2xs text-gray-600 mt-3 border border-bg-border rounded-lg px-3 py-2 inline-block">
              Contact the file owner if you believe this is a mistake.
            </p>
          </div>
        ) : !fileUrl ? (
          <div className="flex items-center gap-3 mt-20 text-gray-500">
            <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading file…</span>
          </div>
        ) : isImage ? (
          <img
            src={fileUrl} alt={info.filename}
            className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
            draggable={false}
            onDragStart={e => e.preventDefault()}
          />
        ) : isPDF ? (
          info.privacyMaskingEnabled && maskedText !== null ? (
            /* ── PDF with masking: styled document renderer ── */
            <div className="w-full max-w-4xl overflow-auto rounded-xl shadow-xl border border-purple-500/20"
              style={{ maxHeight: 'calc(100vh - 160px)', background: '#fff' }}>
              <style>{DOCUMENT_STYLES}</style>
              <div
                className="doc-viewer"
                dangerouslySetInnerHTML={{ __html: formatTextAsDocument(maskedText || '') }}
              />
            </div>
          ) : (
            /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <p className="text-gray-400 text-sm">PDF preview not available on mobile</p>
                <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                  className="px-6 py-3 bg-dna-500 text-white rounded-xl font-semibold text-sm">
                  Open PDF
                </a>
              </div>
            ) : (
              <iframe src={fileUrl} title={info.filename}
                className="w-full rounded-xl border border-bg-border"
                style={{ height: 'calc(100vh - 140px)' }} />
            )
          )
        ) : isDocx ? (
          info.privacyMaskingEnabled && maskedText !== null ? (
            /* ── DOCX with masking: styled document renderer ── */
            <div className="w-full max-w-4xl overflow-auto rounded-xl shadow-xl border border-purple-500/20"
              style={{ maxHeight: 'calc(100vh - 160px)', background: '#fff' }}>
              <style>{DOCUMENT_STYLES}</style>
              <div
                className="doc-viewer"
                dangerouslySetInnerHTML={{ __html: formatTextAsDocument(maskedText || '') }}
              />
            </div>
          ) : (
            /* ── DOCX: rendered inline via docx-preview ── */
            <div ref={docxContainerRef}
              className="w-full bg-white rounded-xl shadow-xl overflow-auto"
              style={{ minHeight: '70vh', maxHeight: 'calc(100vh - 140px)', padding: '8px' }} />
          )
        ) : isVideo ? (
          /* ── VIDEO: native HTML5 player — controls enabled but download blocked ── */
          <div className="w-full max-w-4xl">
            <video
              src={fileUrl}
              controls
              controlsList="nodownload nofullscreen noremoteplayback"
              disablePictureInPicture
              className="w-full rounded-xl shadow-2xl border border-bg-border"
              style={{ maxHeight: 'calc(100vh - 160px)' }}
              onContextMenu={e => e.preventDefault()}
            >
              Your browser does not support inline video playback.
            </video>
            <p className="text-2xs text-gray-500 text-center mt-2">
              🔒 Protected · Access tracked and logged
            </p>
          </div>
        ) : isAudio ? (
          /* ── AUDIO: native HTML5 audio player ── */
          <div className="w-full max-w-xl mt-12">
            <div className="card p-6 text-center space-y-4">
              <div className="w-16 h-16 bg-dna-500/15 rounded-full flex items-center justify-center mx-auto">
                <Shield size={28} className="text-dna-400" />
              </div>
              <p className="text-white font-semibold">{info.filename}</p>
              <audio
                src={fileUrl}
                controls
                controlsList="nodownload"
                className="w-full"
                onContextMenu={e => e.preventDefault()}
              >
                Your browser does not support inline audio playback.
              </audio>
              <p className="text-2xs text-gray-500">🔒 Protected · Access tracked and logged</p>
            </div>
          </div>
        ) : isHtml ? (
          /* ── HTML: render as a real webpage (browser-like) ── */
          <div className="w-full flex-1 flex flex-col print-hide" style={{ minHeight: 'calc(100vh - 120px)' }}>
            {htmlPreviewUrl ? (
              <iframe
                src={htmlPreviewUrl}
                title={info.filename}
                className="w-full flex-1 rounded-xl border border-bg-border bg-white shadow-xl"
                style={{ minHeight: 'calc(100vh - 140px)' }}
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
                Loading page…
              </div>
            )}
            <p className="text-2xs text-gray-500 text-center mt-2">
              🔒 Protected · Access tracked and logged
            </p>
          </div>
        ) : isText ? (
          /* ── TEXT / CSV / JSON ── */
          <div className="w-full max-w-4xl overflow-auto rounded-xl shadow-xl border border-bg-border"
            style={{ maxHeight: 'calc(100vh - 160px)' }}>
            {info.privacyMaskingEnabled && maskedText !== null ? (
              <>
                <style>{DOCUMENT_STYLES}</style>
                <div
                  className="doc-viewer"
                  dangerouslySetInnerHTML={{ __html: formatTextAsDocument(maskedText) }}
                />
              </>
            ) : (
              <pre
                className="bg-bg-card p-4 text-xs text-gray-300 font-mono"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {textContent ?? 'Loading…'}
              </pre>
            )}
            <p className="text-2xs text-gray-500 text-center mt-2">
              🔒 Protected · Access tracked and logged
            </p>
          </div>
        ) : (
          /* ── FALLBACK: ZIP, PPTX, unknown — show secure download card ── */
          <div className="card text-center py-12 max-w-sm">
            <Lock size={32} className="text-dna-400 mx-auto mb-3" />
            <p className="text-white font-semibold mb-1">{info.filename}</p>
            <p className="text-sm text-gray-400 mb-4">
              This file type cannot be previewed in the browser.
            </p>
            {info.allowDownload ? (
              <button onClick={handleDownload} disabled={downloading} className="btn btn-primary">
                <Download size={14} /> Secure Download
              </button>
            ) : (
              <p className="text-xs text-gray-500 border border-bg-border rounded-lg px-3 py-2">
                Download is disabled by the sender for this link.
              </p>
            )}
          </div>
        )}

        {/* Review — renders only when the sender turned it on for this link. */}
        {review && (
          <div className="w-full max-w-3xl mx-auto mt-6 print-hide">
            <ClientReviewPanel
              token={token ?? ''}
              review={review}
              onActivity={() => setReviewNonce((n) => n + 1)}
            />
          </div>
        )}
      </div>

      {/* Full-coverage watermark — survives Win+PrtSc / screen recording.
           Each tile shows token + date so every captured frame is traceable. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none select-none overflow-hidden"
        style={{ zIndex: 1000 }}
      >
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <pattern id="wm" x="0" y="0" width="320" height="120" patternUnits="userSpaceOnUse"
              patternTransform="rotate(-30)">
              <text x="0" y="24" fontFamily="monospace" fontSize="11" fill="#818cf8" opacity="0.18">
                PINIT-DNA · {token}
              </text>
              <text x="0" y="44" fontFamily="monospace" fontSize="9" fill="#818cf8" opacity="0.12">
                {name || 'Viewer'} · {new Date().toLocaleDateString('en-IN')}
              </text>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wm)" />
        </svg>
      </div>

      {/* Viewer shows the file only — the message-the-owner composer was removed.
          The server-side messaging endpoints (/share/:token/messages) are untouched,
          so the feature can be reinstated by re-adding the UI. */}

      {/* Footer */}
      <div className="bg-bg-card border-t border-bg-border px-4 py-2 flex items-center justify-between">
        <p className="text-2xs text-gray-600">
          Protected by Pinit HUB Smart Links · Access is tracked and logged
        </p>
        <p className="text-2xs text-gray-600 mono">{token}</p>
      </div>
    </div>
  );
}
