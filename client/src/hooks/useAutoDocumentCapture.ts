import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { analyzeDocumentFrame, sampleVideoFrame, type FrameMetrics } from '../lib/document-frame-analyzer';

export type AutoScanPhase = 'idle' | 'warming' | 'searching' | 'locking' | 'captured' | 'paused';

interface CaptureProfileConfig {
  warmupMs: number;
  intervalMs: number;
  /** Continuous stability window before auto-capture (ms). */
  stableMsRequired: number;
  motionMax: number;
  requireQuality: boolean;
  /** Force capture after this wait if quality is acceptable (ms). */
  maxWaitMs: number;
}

/** Fast multi-page document scanning */
const FAST: CaptureProfileConfig = {
  warmupMs: 400,
  intervalMs: 80,
  stableMsRequired: 500,
  motionMax: 0.14,
  requireQuality: false,
  maxWaitMs: 3000,
};

/**
 * Forensic single capture (Unified Investigation) — balanced speed + quality.
 * Manual "Capture Now" always available.
 */
const FORENSIC: CaptureProfileConfig = {
  warmupMs: 500,
  intervalMs: 80,
  stableMsRequired: 650,
  motionMax: 0.12,
  requireQuality: true,
  maxWaitMs: 3000,
};

/** Mobile / screen-photo capture — relaxed detection, still quality-aware */
const SCREEN: CaptureProfileConfig = {
  warmupMs: 400,
  intervalMs: 80,
  stableMsRequired: 600,
  motionMax: 0.14,
  requireQuality: true,
  maxWaitMs: 3000,
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

function resolveProfile(profile: AutoCaptureProfile): CaptureProfileConfig {
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

/** Relaxed quality bar for capture — no motion requirement (stability handled live). */
function isQualityAcceptable(metrics: FrameMetrics, captureProfile: AutoCaptureProfile): boolean {
  if (captureProfile === 'screen') {
    return (
      metrics.exposureOk &&
      metrics.glare < 0.35 &&
      metrics.sharpness >= 0.07 &&
      metrics.contrast >= 0.06
    );
  }
  return (
    metrics.documentPresent &&
    metrics.exposureOk &&
    metrics.glare < 0.28 &&
    metrics.sharpness >= 0.09 &&
    metrics.contrast >= 0.08 &&
    metrics.edgeDensity >= 0.015
  );
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
  const stableSinceRef = useRef<number | null>(null);
  const readySinceRef = useRef<number | null>(null);
  const armedRef = useRef(true);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  const armNextCapture = useCallback(() => {
    armedRef.current = true;
    setArmed(true);
    stableSinceRef.current = null;
    readySinceRef.current = null;
    prevLumRef.current = null;
    setPhase('searching');
    setHint('Align next page in the frame');
    setProgress(0);
  }, []);

  const notifyCaptured = useCallback((luminance?: Float32Array | null) => {
    stableSinceRef.current = null;
    readySinceRef.current = null;
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
    stableSinceRef.current = null;
    readySinceRef.current = null;
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
      stableSinceRef.current = null;
      readySinceRef.current = null;
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
    stableSinceRef.current = null;
    readySinceRef.current = null;
    prevLumRef.current = null;
    armedRef.current = true;
    setArmed(true);

    const fireCapture = (luminance: Float32Array) => {
      try {
        navigator.vibrate?.(40);
      } catch {
        /* unsupported */
      }
      onCaptureRef.current();
      notifyCaptured(luminance);
    };

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

      if (readySinceRef.current === null) {
        readySinceRef.current = now;
      }

      const frame = sampleVideoFrame(video, canvasRef.current!);
      if (!frame) {
        stableSinceRef.current = null;
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
          stableSinceRef.current = null;
          setPhase('searching');
          setHint('Move to a new page or tap Scan Next Page');
          setProgress(0);
          return;
        }
      }

      if (!metrics.documentPresent && profile !== 'screen') {
        stableSinceRef.current = null;
        setPhase('searching');
        setHint(profile === 'forensic'
          ? 'Center the file in the frame'
          : 'Align document inside the frame');
        setProgress(0);
        return;
      }

      const isStable = metrics.motion < cfg.motionMax;
      const qualityOk = !cfg.requireQuality || isQualityAcceptable(metrics, profile);
      const waitedMs = now - (readySinceRef.current ?? now);
      const timedOut = waitedMs >= cfg.maxWaitMs;

      if (!isStable) {
        stableSinceRef.current = null;
        setPhase('searching');
        setHint('Hold still — almost there…');
        setProgress(Math.min(40, Math.round(metrics.qualityScore * 40)));
        return;
      }

      if (stableSinceRef.current === null) {
        stableSinceRef.current = now;
      }
      const stableMs = now - stableSinceRef.current;

      if (cfg.requireQuality && !qualityOk && !timedOut) {
        setPhase('searching');
        if (metrics.sharpness < 0.09) {
          setHint('Move closer or improve focus');
        } else if (metrics.glare > 0.22) {
          setHint('Tilt device slightly to reduce glare');
        } else if (!metrics.exposureOk) {
          setHint('Adjust lighting — too dark or bright');
        } else {
          setHint('Center the document in the frame');
        }
        setProgress(Math.round(metrics.qualityScore * 50));
        return;
      }

      const stablePct = Math.min(100, Math.round((stableMs / cfg.stableMsRequired) * 100));
      const waitPct = Math.min(100, Math.round((waitedMs / cfg.maxWaitMs) * 100));
      const pct = Math.max(stablePct, timedOut ? waitPct : 0);

      setProgress(pct);
      setPhase('locking');
      setHint(
        timedOut && qualityOk
          ? 'Capturing now…'
          : pct >= 85
            ? 'Perfect — capturing…'
            : 'Document detected — hold steady…',
      );

      const shouldCapture =
        (stableMs >= cfg.stableMsRequired && qualityOk) ||
        (timedOut && qualityOk);

      if (shouldCapture) {
        fireCapture(luminance);
      }
    };

    const id = window.setInterval(tick, cfg.intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, videoRef, notifyCaptured, cfg, profile]);

  return { phase, progress, hint, armed, armNextCapture, resetCapture, notifyCaptured };
}
