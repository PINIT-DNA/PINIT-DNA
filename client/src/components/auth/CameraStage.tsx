import { useEffect, useRef, useState } from 'react';
import { Camera, Check } from 'lucide-react';

interface CameraStageProps {
  /** Start the camera when true. */
  active: boolean;
  /** 0..100 progress ring around the viewport. */
  progress?: number;
  /** Render the success (green) state. */
  done?: boolean;
  /** Called once when the camera stream is live (or fails — `false`). */
  onReady?: (ok: boolean) => void;
  /** Called with a captured JPEG data URL (or null if no camera) when `done` flips true. */
  onCapture?: (dataUrl: string | null) => void;
}

/**
 * Circular live-camera viewport with scan line + progress ring. Gracefully
 * degrades to a placeholder when no camera is available (desktop/denied), so
 * the flow is still demonstrable everywhere.
 */
export function CameraStage({ active, progress = 0, done = false, onReady, onCapture }: CameraStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedRef = useRef(false);
  const [hasCam, setHasCam] = useState<boolean | null>(null);

  /** Grab the current video frame as a compact JPEG data URL. */
  function captureFrame(): string | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const size = 240;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const min = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - min) / 2;
    const sy = (video.videoHeight - min) / 2;
    ctx.drawImage(video, sx, sy, min, min, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  // Capture one frame the moment the scan completes.
  useEffect(() => {
    if (done && !capturedRef.current && onCapture) {
      capturedRef.current = true;
      onCapture(captureFrame());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!active) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setHasCam(true);
        onReady?.(true);
      } catch {
        if (cancelled) return;
        setHasCam(false);
        onReady?.(false);
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className={`pa-cam${done ? ' ok' : ''}`}>
      {hasCam !== false && <video ref={videoRef} muted playsInline />}

      {hasCam === false && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: '#7c84ad',
          }}
        >
          <Camera size={34} />
          <span style={{ fontSize: 11, textAlign: 'center', padding: '0 24px' }}>
            Camera unavailable — simulating capture
          </span>
        </div>
      )}

      {!done && active && <div className="pa-cam-scan" />}
      {progress > 0 && !done && (
        <div className="pa-ring" style={{ ['--p' as string]: `${Math.min(100, progress)}%` }} />
      )}

      {done && (
        <div
          className="pa-pop"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(5,6,15,0.35)',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 28px rgba(16,185,129,0.7)',
            }}
          >
            <Check size={34} color="#fff" strokeWidth={3} />
          </div>
        </div>
      )}
    </div>
  );
}
