import { useEffect, useRef, useState } from 'react';
import { Camera, ScanFace } from 'lucide-react';
import { CameraStage } from './CameraStage';
import { StepHead } from './parts';
import { ensureFaceModels } from '../../lib/face-capture';
import { runPadCapture } from '../../lib/face-liveness';
import type { FacePadEvidence } from '../../lib/face-api-client';

interface FaceRoundScanProps {
  title?: string;
  mode?: 'register' | 'login';
  claimedShortId?: string;
  scanAttempts?: number;
  identityError?: string;
  onClearIdentity?: () => void;
  onEmbedding: (emb: number[]) => void;
  onPadEvidence?: (evidence: FacePadEvidence) => void;
  onLightingSample?: (status: string, average: number) => void;
  onCapture?: (img: string | null) => void;
  onNext: () => void;
  onError: (msg: string) => void;
  onScanStart?: () => void;
}

/** Round-camera face scan with server-issued liveness challenge. */
export function FaceRoundScan({
  title = 'Face Enrollment',
  mode = 'register',
  claimedShortId,
  identityError,
  onClearIdentity,
  onEmbedding,
  onPadEvidence,
  onCapture,
  onNext,
  onError,
  onScanStart,
}: FaceRoundScanProps) {
  const [scanning, setScanning] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [hint, setHint] = useState('Face the camera, then follow the motion prompts');
  const scanningRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => { void ensureFaceModels(); }, []);

  async function runCapture(video: HTMLVideoElement) {
    if (scanningRef.current) return;
    scanningRef.current = true;
    onScanStart?.();
    setScanning(true);
    setProgress(0);
    try {
      const result = await runPadCapture(video, {
        onProgress: setProgress,
        onHint: setHint,
      });
      onEmbedding(result.embedding);
      onPadEvidence?.(result.padEvidence);
      setDone(true);
      setTimeout(onNext, 280);
    } catch (e) {
      scanningRef.current = false;
      setScanning(false);
      setProgress(0);
      onError(e instanceof Error ? e.message : 'Face scan failed.');
    }
  }

  function onVideoReady(el: HTMLVideoElement | null) {
    videoRef.current = el;
    setCamReady(Boolean(el && el.videoWidth > 0));
  }

  useEffect(() => {
    if (mode !== 'login' || !camReady || !videoRef.current || scanningRef.current || done) return;
    void runCapture(videoRef.current);
  }, [mode, camReady, done]);

  function start() {
    if (!camReady || !videoRef.current) {
      onError('Camera still starting — wait a second and tap again.');
      return;
    }
    void runCapture(videoRef.current);
  }

  return (
    <div className="pa-card">
      <StepHead
        icon={<ScanFace size={26} color="#2f7cf6" />}
        title={title}
        subtitle={
          scanning ? hint
            : done ? 'Face captured'
              : camReady ? 'Tap start — follow the live motion prompts'
                : 'Starting camera…'
        }
      />
      <CameraStage
        active
        progress={progress}
        done={done}
        onCapture={onCapture}
        onVideoReady={onVideoReady}
      />
      {identityError && (
        <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 12, textAlign: 'center' }}>{identityError}</p>
      )}
      {mode === 'login' && onClearIdentity && (
        <button type="button" className="pa-btn pa-btn-ghost" style={{ marginTop: 8, textDecoration: 'underline' }} onClick={onClearIdentity}>
          Not you? Switch account or enter a different Pinit ID
        </button>
      )}
      {scanning && !done && (
        <p className="pa-accent" style={{ textAlign: 'center', fontSize: 13, marginTop: 14 }}>
          Scanning · {Math.round(progress)}%
        </p>
      )}
      {!scanning && !done && (
        <button className="pa-btn" style={{ marginTop: 12 }} onClick={start} disabled={!camReady}>
          <Camera size={16} /> {camReady ? 'Start Face Scan' : 'Preparing camera…'}
        </button>
      )}
    </div>
  );
}
