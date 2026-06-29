import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { analyzeDocumentFrame, sampleVideoFrame } from '../lib/document-frame-analyzer';

export type AutoScanPhase = 'idle' | 'warming' | 'searching' | 'locking' | 'captured' | 'paused';

const WARMUP_MS = 600;
const INTERVAL_MS = 120;
const STABLE_FRAMES_REQUIRED = 5;
/** Frames must differ from last capture by at least this much before another auto-shot. */
const MIN_CHANGE_AFTER_CAPTURE = 0.08;

interface Options {
  enabled: boolean;
  onCapture: () => void;
  /** When true (default), auto-capture stops after each shot until armNextCapture(). */
  pauseAfterCapture?: boolean;
}

function frameChangeScore(current: Float32Array, baseline: Float32Array): number {
  let diff = 0;
  const n = Math.min(current.length, baseline.length);
  for (let i = 0; i < n; i++) diff += Math.abs(current[i]! - baseline[i]!);
  return diff / n / 255;
}

export function useAutoDocumentCapture(
  videoRef: RefObject<HTMLVideoElement | null>,
  { enabled, onCapture, pauseAfterCapture = true }: Options,
) {
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
      setHint('Captured!');
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
    setHint('Point camera at document…');
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
      if (now - startedAt < WARMUP_MS) {
        setPhase('warming');
        setHint('Point camera at document…');
        return;
      }

      const frame = sampleVideoFrame(video, canvasRef.current!);
      if (!frame) {
        setPhase('searching');
        setHint('Adjust lighting and hold document in frame');
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

      if (!metrics.documentPresent) {
        stableCountRef.current = 0;
        setPhase('searching');
        setHint('Align document inside the frame');
        setProgress(0);
        return;
      }

      if (!metrics.stable) {
        stableCountRef.current = 0;
        setPhase('searching');
        setHint('Hold steady…');
        setProgress(0);
        return;
      }

      stableCountRef.current += 1;
      const pct = Math.min(100, Math.round((stableCountRef.current / STABLE_FRAMES_REQUIRED) * 100));
      setProgress(pct);
      setPhase('locking');
      setHint('Document detected — hold steady…');

      if (stableCountRef.current >= STABLE_FRAMES_REQUIRED) {
        try {
          navigator.vibrate?.(40);
        } catch {
          /* unsupported */
        }
        onCaptureRef.current();
        notifyCaptured(luminance);
      }
    };

    const id = window.setInterval(tick, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, videoRef, notifyCaptured]);

  return { phase, progress, hint, armed, armNextCapture, resetCapture, notifyCaptured };
}
