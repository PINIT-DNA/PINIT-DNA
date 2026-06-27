import { useEffect, useRef, useState } from 'react';
import { Camera, ScanFace } from 'lucide-react';
import { CameraStage } from './CameraStage';
import { StepHead } from './parts';
import { captureFaceEmbeddingFromVideo, ensureFaceModels } from '../../lib/face-capture';

const HINTS = ['Look at the camera', 'Hold still…', 'Almost done…'];

interface FaceRoundScanProps {
  title?: string;
  mode?: 'register' | 'login';
  onEmbedding: (emb: number[]) => void;
  onCapture?: (img: string | null) => void;
  onNext: () => void;
  onError: (msg: string) => void;
}

/** Round-camera face scan — preview starts immediately, scan is fast (~1–2 s). */
export function FaceRoundScan({
  title = 'Face Enrollment',
  mode = 'login',
  onEmbedding,
  onCapture,
  onNext,
  onError,
}: FaceRoundScanProps) {
  const [scanning, setScanning] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [hint, setHint] = useState(HINTS[0]!);
  const scanningRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => { void ensureFaceModels(); }, []);

  useEffect(() => {
    if (!scanning || done) return;
    let i = 0;
    const iv = setInterval(() => {
      i = (i + 1) % HINTS.length;
      setHint(HINTS[i]!);
    }, 700);
    return () => clearInterval(iv);
  }, [scanning, done]);

  async function runCapture(video: HTMLVideoElement) {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    setProgress(0);
    try {
      const embedding = await captureFaceEmbeddingFromVideo(video, setProgress, { mode });
      onEmbedding(embedding);
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
        icon={<ScanFace size={26} color="#6366f1" />}
        title={title}
        subtitle={
          scanning ? hint
            : done ? 'Face captured'
              : camReady ? 'Tap start — scan takes about 2 seconds'
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
