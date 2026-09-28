import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { jsPDF } from 'jspdf';
import {
  cameraErrorMessage,
  openCameraStream,
  releaseMediaStream,
  type CameraFacing,
} from '../lib/camera-stream';
import { tagProtectFile } from '../lib/protect-capture-context';

type StudioMode = 'photo' | 'portrait' | 'video' | 'scan';

const MODES: { id: StudioMode; label: string }[] = [
  { id: 'photo', label: 'PHOTO' },
  { id: 'portrait', label: 'PORTRAIT' },
  { id: 'video', label: 'VIDEO' },
  { id: 'scan', label: 'SCAN' },
];

function timestampName(prefix: string, ext: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}-${stamp}${ext}`;
}

function blobToFile(blob: Blob, name: string, method = 'PinIT Secure Capture'): File {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream', lastModified: Date.now() });
  try {
    Object.defineProperty(file, 'pinitCaptureMethod', { value: method, enumerable: false });
  } catch {
    (file as File & { pinitCaptureMethod?: string }).pinitCaptureMethod = method;
  }
  return file;
}

function pickRecorderMime(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read capture'));
    reader.readAsDataURL(blob);
  });
}

function captureStill(video: HTMLVideoElement, cropPortrait: boolean): Promise<Blob> {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;
  if (cropPortrait) {
    const target = 3 / 4;
    const current = vw / vh;
    if (current > target) {
      sw = Math.round(vh * target);
      sx = Math.round((vw - sw) / 2);
    } else {
      sh = Math.round(vw / target);
      sy = Math.round((vh - sh) / 2);
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas unavailable'));
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Capture failed'))), 'image/jpeg', 0.92);
  });
}

interface ProtectCaptureStudioProps {
  onFileReady: (file: File) => void;
}

export function ProtectCaptureStudio({ onFileReady }: ProtectCaptureStudioProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const genRef = useRef(0);
  const modeRef = useRef<StudioMode>('photo');

  const [mode, setMode] = useState<StudioMode>('photo');
  const [facing, setFacing] = useState<CameraFacing>('environment');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scanPages, setScanPages] = useState<Blob[]>([]);
  const [flash, setFlash] = useState(false);

  modeRef.current = mode;

  const stopRecorder = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* */
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    genRef.current += 1;
    stopRecorder();
    releaseMediaStream(streamRef.current, videoRef.current);
    streamRef.current = null;
    setReady(false);
    setRecording(false);
    setRecordSec(0);
  }, [stopRecorder]);

  const attachStream = useCallback(async (nextFacing: CameraFacing, withAudio: boolean) => {
    const gen = ++genRef.current;
    releaseMediaStream(streamRef.current, videoRef.current);
    streamRef.current = null;
    setReady(false);

    let stream: MediaStream;
    try {
      stream = await openCameraStream({ facingMode: nextFacing, audio: withAudio });
    } catch (err) {
      if (withAudio) {
        stream = await openCameraStream({ facingMode: nextFacing, audio: false });
      } else {
        throw err;
      }
    }

    if (gen !== genRef.current) {
      releaseMediaStream(stream);
      return;
    }

    streamRef.current = stream;
    const el = videoRef.current;
    if (el) {
      el.srcObject = stream;
      await el.play().catch(() => undefined);
    }
    setReady(true);
  }, []);

  const startCamera = useCallback(
    async (nextFacing: CameraFacing) => {
      setBusy(true);
      setError(null);
      try {
        await attachStream(nextFacing, modeRef.current === 'video');
      } catch (err) {
        setError(cameraErrorMessage(err, 'You can still add a file with +.'));
        setReady(false);
      } finally {
        setBusy(false);
      }
    },
    [attachStream],
  );

  useEffect(() => {
    return () => {
      genRef.current += 1;
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          /* */
        }
      }
      releaseMediaStream(streamRef.current, videoRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setRecordSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const switchFacing = () => {
    if (recording) return;
    const next: CameraFacing = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    if (ready) void startCamera(next);
  };

  const takeStill = async () => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 160);
    try {
      const blob = await captureStill(video, mode === 'portrait');
      if (mode === 'scan') {
        setScanPages((pages) => [...pages, blob]);
        return;
      }
      const prefix = mode === 'portrait' ? 'Portrait' : 'Photo';
      const file = blobToFile(blob, timestampName(prefix, '.jpg'));
      stopCamera();
      onFileReady(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture');
    } finally {
      setBusy(false);
    }
  };

  const finishScan = async () => {
    if (!scanPages.length || busy) return;
    setBusy(true);
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      for (let i = 0; i < scanPages.length; i++) {
        if (i > 0) pdf.addPage();
        const dataUrl = await blobToDataUrl(scanPages[i]!);
        pdf.addImage(dataUrl, 'JPEG', 0, 0, pageW, pageH);
      }
      const file = blobToFile(pdf.output('blob'), timestampName('Scan', '.pdf'));
      setScanPages([]);
      stopCamera();
      onFileReady(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build scan');
    } finally {
      setBusy(false);
    }
  };

  const startVideo = () => {
    const stream = streamRef.current;
    if (!stream || recording) return;
    chunksRef.current = [];
    const mime = pickRecorderMime();
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime.split(';')[0] });
      const ext = mime.includes('mp4') ? '.mp4' : '.webm';
      setRecording(false);
      setRecordSec(0);
      stopCamera();
      if (blob.size > 0) onFileReady(blobToFile(blob, timestampName('Video', ext)));
    };
    recorderRef.current = rec;
    rec.start(250);
    setRecordSec(0);
    setRecording(true);
  };

  const stopVideo = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    recorderRef.current = null;
  };

  const onShutter = () => {
    if (busy) return;
    if (!ready) {
      void startCamera(facing);
      return;
    }
    if (mode === 'video') {
      if (recording) stopVideo();
      else startVideo();
      return;
    }
    void takeStill();
  };

  const deliverFile = (file: File) => {
    stopCamera();
    onFileReady(file);
  };

  const onLibrary = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) deliverFile(tagProtectFile(file, 'Upload'));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) deliverFile(tagProtectFile(file, 'Upload'));
  };

  return (
    <div
      className="relative mx-auto w-full max-w-md overflow-hidden rounded-[28px] bg-black shadow-2xl ring-1 ring-black/20"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="relative aspect-[9/16] w-full bg-black sm:aspect-[3/4]">
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover ${ready ? '' : 'invisible'} ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
          playsInline
          muted
        />

        {!ready && !error && <div className="absolute inset-0 bg-neutral-950" />}

        {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}

        {ready && mode === 'portrait' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[72%] w-[58%] rounded-[40%] border border-white/35 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
          </div>
        )}

        {ready && mode === 'scan' && (
          <div className="pointer-events-none absolute inset-[12%] rounded-md border border-white/50" />
        )}

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-2 pb-10 pt-3">
          <div className="flex items-center justify-center gap-0.5 overflow-x-auto">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={recording}
                onClick={() => {
                  if (item.id !== 'scan') setScanPages([]);
                  setMode(item.id);
                }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] transition ${
                  mode === item.id ? 'bg-white text-black' : 'ink-photo-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {recording && (
          <div className="absolute left-1/2 top-14 -translate-x-1/2 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold tabular-nums ink-photo">
            REC {String(Math.floor(recordSec / 60)).padStart(2, '0')}:{String(recordSec % 60).padStart(2, '0')}
          </div>
        )}

        {error && (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-black/80 p-4 text-center text-sm ink-photo">
            <p>{error}</p>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black"
              onClick={() => {
                setError(null);
                void startCamera(facing);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-5 pb-5 pt-16">
          {mode === 'scan' && scanPages.length > 0 && (
            <div className="mb-3 flex items-center justify-between text-xs ink-photo">
              <span>
                {scanPages.length} page{scanPages.length === 1 ? '' : 's'}
              </span>
              <button type="button" className="font-semibold ink-photo" onClick={() => void finishScan()} disabled={busy}>
                Done
              </button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-black shadow-[0_2px_10px_rgba(0,0,0,0.55)]"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Add a file"
              title="Add a file"
            >
              <Plus className="h-7 w-7" strokeWidth={2.75} />
            </button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={onLibrary} />

            <button
              type="button"
              disabled={busy}
              onClick={onShutter}
              className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full border-[3px] border-white"
              aria-label={
                !ready
                  ? 'Open camera'
                  : mode === 'video'
                    ? recording
                      ? 'Stop recording'
                      : 'Start recording'
                    : 'Take photo'
              }
            >
              <span
                className={`block rounded-full transition ${
                  mode === 'video' && ready
                    ? recording
                      ? 'h-7 w-7 rounded-md bg-red-500'
                      : 'h-14 w-14 bg-red-500'
                    : 'h-14 w-14 bg-white'
                }`}
              />
            </button>

            <button
              type="button"
              disabled={recording}
              onClick={switchFacing}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-[0_2px_10px_rgba(0,0,0,0.55)]"
              aria-label="Switch camera"
              title="Switch camera"
            >
              <RefreshCw className="h-6 w-6" strokeWidth={2.5} />
            </button>
          </div>

          <p className="mt-3 text-center text-[11px] ink-photo-muted">
            {ready && mode === 'photo' && 'Tap to take a photo'}
            {ready && mode === 'portrait' && 'Center yourself, then tap'}
            {ready && mode === 'video' && (recording ? 'Tap to stop' : 'Tap to record')}
            {ready && mode === 'scan' && (scanPages.length ? 'Tap to add another page, then Done' : 'Line up the page, then tap')}
          </p>
        </div>
      </div>
    </div>
  );
}
