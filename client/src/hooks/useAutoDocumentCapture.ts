import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { analyzeDocumentFrame, sampleVideoFrame } from '../lib/document-frame-analyzer';

export type AutoScanPhase = 'idle' | 'warming' | 'searching' | 'locking' | 'captured' | 'paused';

/** Fast multi-page document scanning */
const FAST = {
  warmupMs: 600,
  intervalMs: 120,
  stableFramesRequired: 5,
  motionMax: 0.04,
  requireQuality: false,
};

/**
 * Forensic single capture (Unified Investigation) — balanced speed + quality.
 * ~2–3s typical; manual "Capture Now" always available.
 */
const FORENSIC = {
  warmupMs: 800,
  intervalMs: 100,
  stableFramesRequired: 6,
  motionMax: 0.028,
  requireQuality: true,
};

/** Mobile / screen-photo capture — relaxed detection, still quality-aware */
const SCREEN = {
  warmupMs: 600,
  intervalMs: 100,
  stableFramesRequired: 5,
  motionMax: 0.045,
  requireQuality: true,
};

/** Frames must differ from last capture by at least this much before another auto-shot. */
const MIN_CHANGE_AFTER_CAPTURE = 0.08;

export type AutoCaptureProfile = 'fast' | 'forensic' | 'screen';

interface Options {
  enabled: boolean;
  onCapture: () => void;
  /** When true (default), auto-capture stops after each shot until armNextCapture(). */
  pauseAfterCapture?: boolean;
  /** forensic = investigation scans; screen = relaxed for phone screenshots */
  profile?: AutoCaptureProfile;
}

function resolveProfile(profile: AutoCaptureProfile) {
  if (profile === 'forensic') return FORENSIC;
  if (profile === 'screen') return SCREEN;
  return FAST;
}

function frameChangeScore(current: Float32Array, baseline: Float32Array): number {
  let diff = 0;
  const n = Math.min(current.length, baseline.length);
  for (let i = 0; i < n; i++) diff += Math.abs(current[i]! - baseline[i]!);
  return diff / n / 255;
}

export function useAutoDocumentCapture(
  videoRef: RefObject<HTMLVideoElement | null>,
  { enabled, onCapture, pauseAfterCapture = true, profile = 'fast' }: Options,
) {
  const cfg = resolveProfile(profile);

  const [phase, setPhase] = useState<AutoScanPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState('Opening camera…');
  const [armed, setArmed] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevLumRef = useRef<Float32Array | null>(null);
  const lastCaptureLumRef = useRef<Float32Array | null>(null);
  const stableCountRef = useRef(0);
  const armedRef = useRef(true);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  const armNextCapture = useCallback(() => {
    armedRef.current = true;
    setArmed(true);
    stableCountRef.current = 0;
    prevLumRef.current = null;
    setPhase('searching');
    setHint('Align next page in the frame');
    setProgress(0);
  }, []);

  const notifyCaptured = useCallback((luminance?: Float32Array | null) => {
    stableCountRef.current = 0;
    prevLumRef.current = null;
    if (luminance) {
      lastCaptureLumRef.current = new Float32Array(luminance);
    }
    if (pauseAfterCapture) {
      armedRef.current = false;
      setArmed(false);
      setPhase('paused');
      setHint('Page captured — tap Scan Next Page or Done');
      setProgress(0);
    } else {
      setPhase('captured');
      setHint('Clear capture — starting investigation…');
      setProgress(100);
      window.setTimeout(() => {
        setPhase('searching');
        setHint('Align document inside the frame');
        setProgress(0);
      }, 700);
    }
  }, [pauseAfterCapture]);

  const resetCapture = useCallback(() => {
    armedRef.current = true;
    setArmed(true);
    stableCountRef.current = 0;
    prevLumRef.current = null;
    lastCaptureLumRef.current = null;
    setPhase('searching');
    setHint('Align document inside the frame');
    setProgress(0);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPhase('idle');
      setProgress(0);
      setHint('Opening camera…');
      stableCountRef.current = 0;
      prevLumRef.current = null;
      armedRef.current = true;
      setArmed(true);
      return;
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }

    const startedAt = Date.now();
    setPhase('warming');
    setHint(profile === 'forensic'
      ? 'Hold steady — auto-capture in a moment…'
      : profile === 'screen'
        ? 'Point at your vault screen — tap Capture Now anytime'
        : 'Point camera at document…');
    stableCountRef.current = 0;
    prevLumRef.current = null;
    armedRef.current = true;
    setArmed(true);

    const tick = () => {
      const video = videoRef.current;
      if (!video) return;

      if (!armedRef.current) {
        setPhase('paused');
        return;
      }

      const now = Date.now();
      if (now - startedAt < cfg.warmupMs) {
        setPhase('warming');
        const warmupPct = Math.round(((now - startedAt) / cfg.warmupMs) * 100);
        setProgress(warmupPct);
        setHint(profile === 'forensic'
          ? 'Hold steady — auto-capture in a moment…'
          : profile === 'screen'
            ? 'Center the vault file on screen'
            : 'Point camera at document…');
        return;
      }

      const frame = sampleVideoFrame(video, canvasRef.current!);
      if (!frame) {
        setPhase('searching');
        setHint('Adjust lighting and hold document in frame');
        setProgress(0);
        return;
      }

      const { metrics, luminance } = analyzeDocumentFrame(frame, prevLumRef.current);
      prevLumRef.current = luminance;

      if (lastCaptureLumRef.current) {
        const change = frameChangeScore(luminance, lastCaptureLumRef.current);
        if (change < MIN_CHANGE_AFTER_CAPTURE) {
          stableCountRef.current = 0;
          setPhase('searching');
          setHint('Move to a new page or tap Scan Next Page');
          setProgress(0);
          return;
        }
      }

      if (!metrics.documentPresent && profile !== 'screen') {
        stableCountRef.current = 0;
        setPhase('searching');
        setHint(profile === 'forensic'
          ? 'Center the file in the frame'
          : 'Align document inside the frame');
        setProgress(0);
        return;
      }

      const isStable = metrics.motion < cfg.motionMax;

      if (!isStable) {
        stableCountRef.current = 0;
        setPhase('searching');
        setHint('Hold steady — reduce shake');
        setProgress(0);
        return;
      }

      if (cfg.requireQuality && !metrics.qualityOk) {
        stableCountRef.current = 0;
        setPhase('searching');
        if (metrics.sharpness < 0.14) {
          setHint('Hold steady — image too blurry');
        } else if (metrics.glare > 0.2) {
          setHint('Glare detected — tilt device to reduce reflection');
        } else if (!metrics.exposureOk) {
          setHint('Adjust lighting — document over or under exposed');
        } else if (metrics.contrast < 0.11) {
          setHint('Improve lighting — document not clear enough');
        } else {
          setHint('Center entire document in frame');
        }
        setProgress(Math.round(metrics.qualityScore * 50));
        return;
      }

      stableCountRef.current += 1;
      const pct = Math.min(100, Math.round((stableCountRef.current / cfg.stableFramesRequired) * 100));
      setProgress(pct);
      setPhase('locking');
      setHint(profile === 'forensic'
        ? pct >= 85 ? 'Perfect — capturing…' : 'Sharp frame detected — hold steady…'
        : 'Document detected — hold steady…');

      if (stableCountRef.current >= cfg.stableFramesRequired) {
        try {
          navigator.vibrate?.(40);
        } catch {
          /* unsupported */
        }
        onCaptureRef.current();
        notifyCaptured(luminance);
      }
    };

    const id = window.setInterval(tick, cfg.intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, videoRef, notifyCaptured, cfg, profile]);

  return { phase, progress, hint, armed, armNextCapture, resetCapture, notifyCaptured };
}
