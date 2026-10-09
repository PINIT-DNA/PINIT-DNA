import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  Camera,
  Flashlight,
  Grid3x3,
  Images,
  RefreshCw,
  ScanLine,
  Sparkles,
  Timer,
  UserRound,
  Video,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import {
  cameraErrorMessage,
  openCameraStream,
  preferContinuousFocus,
  preferNaturalExposure,
  releaseMediaStream,
  setTorch,
  trackSupportsTorch,
  type CameraFacing,
} from '../lib/camera-stream';
import { tagProtectFile } from '../lib/protect-capture-context';
import { useAutoDocumentCapture } from '../hooks/useAutoDocumentCapture';
import { MediaRecorderPanel } from './MediaRecorderPanel';

type StudioMode = 'photo' | 'portrait' | 'video' | 'scan';
type FilterId = 'none' | 'vivid' | 'cool' | 'warm';

const MODES: { id: StudioMode; label: string; icon: typeof Camera }[] = [
  { id: 'photo', label: 'Photo', icon: Camera },
  { id: 'portrait', label: 'Portrait', icon: UserRound },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'scan', label: 'Scan', icon: ScanLine },
];

const FILTERS: { id: FilterId; label: string; css: string }[] = [
  { id: 'none', label: 'Original', css: 'none' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.25) contrast(1.08)' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.05) hue-rotate(-12deg) brightness(1.02)' },
  { id: 'warm', label: 'Warm', css: 'saturate(1.12) sepia(0.18) contrast(1.04)' },
];

function timestampName(prefix: string, ext: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}-${stamp}${ext}`;
}

function blobToFile(blob: Blob, name: string, method = 'PinIT Camera'): File {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream', lastModified: Date.now() });
  return tagProtectFile(file, method);
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

function captureStill(
  video: HTMLVideoElement,
  cropPortrait: boolean,
  filterCss: string,
): Promise<Blob> {
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
  if (filterCss && filterCss !== 'none') ctx.filter = filterCss;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Capture failed'))), 'image/jpeg', 0.95);
  });
}

function RailControl({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-[72px] flex-col items-center gap-1 rounded-xl px-1 py-2 transition ${
        active ? 'bg-white/15 text-white' : 'text-white/90 hover:bg-white/10'
      } disabled:opacity-35`}
    >
      {children}
      <span className="text-[10px] font-semibold tracking-wide">{label}</span>
    </button>
  );
}

function FocusReticle() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[46%] h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2">
      <span className="absolute left-0 top-0 h-4 w-4 rounded-tl-full border-l-2 border-t-2 border-white/80" />
      <span className="absolute right-0 top-0 h-4 w-4 rounded-tr-full border-r-2 border-t-2 border-white/80" />
      <span className="absolute bottom-0 left-0 h-4 w-4 rounded-bl-full border-b-2 border-l-2 border-white/80" />
      <span className="absolute bottom-0 right-0 h-4 w-4 rounded-br-full border-b-2 border-r-2 border-white/80" />
      <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
    </div>
  );
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
  const timerRef = useRef<number | null>(null);

  const [mode, setMode] = useState<StudioMode>('photo');
  const [facing, setFacing] = useState<CameraFacing>('environment');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scanPages, setScanPages] = useState<Blob[]>([]);
  const [flash, setFlash] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [filter, setFilter] = useState<FilterId>('none');
  const [filterOpen, setFilterOpen] = useState(false);
  const [timerSec, setTimerSec] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const [shutterPulse, setShutterPulse] = useState(false);

  modeRef.current = mode;
  const filterCss = FILTERS.find((f) => f.id === filter)?.css ?? 'none';

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
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdown(null);
    setTorchOn(false);
    releaseMediaStream(streamRef.current, videoRef.current);
    streamRef.current = null;
    setReady(false);
    setRecording(false);
    setRecordSec(0);
    setTorchOk(false);
  }, [stopRecorder]);

  const attachStream = useCallback(async (nextFacing: CameraFacing, withAudio: boolean) => {
    const gen = ++genRef.current;
    releaseMediaStream(streamRef.current, videoRef.current);
    streamRef.current = null;
    setReady(false);
    setTorchOn(false);

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
    const track = stream.getVideoTracks()[0];
    if (track) {
      await preferNaturalExposure(track);
      await preferContinuousFocus(track);
      setTorchOk(trackSupportsTorch(track));
    } else {
      setTorchOk(false);
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
        setError(cameraErrorMessage(err, 'You can still add a file from Gallery.'));
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

  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (!ready || recording) return;
    const needMic = mode === 'video';
    const hadMic = prev === 'video';
    if (needMic === hadMic) return;
    void attachStream(facing, needMic).catch((err) => {
      setError(cameraErrorMessage(err, 'You can still add a file from Gallery.'));
      setReady(false);
    });
    // Live stream already granted — only re-open when video (mic) is toggled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const switchFacing = () => {
    if (recording) return;
    const next: CameraFacing = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    if (ready) void startCamera(next);
  };

  const takeStill = useCallback(async () => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    setFlash(true);
    setShutterPulse(true);
    window.setTimeout(() => setFlash(false), 140);
    window.setTimeout(() => setShutterPulse(false), 220);
    try {
      const blob = await captureStill(video, modeRef.current === 'portrait', filterCss);
      if (modeRef.current === 'scan') {
        setScanPages((pages) => [...pages, blob]);
        return;
      }
      const prefix = modeRef.current === 'portrait' ? 'Portrait' : 'Photo';
      const file = blobToFile(blob, timestampName(prefix, '.jpg'));
      stopCamera();
      onFileReady(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture');
    } finally {
      setBusy(false);
    }
  }, [busy, filterCss, onFileReady, stopCamera]);

  const { hint: scanHint, phase: scanPhase, armNextCapture } = useAutoDocumentCapture(videoRef, {
    enabled: ready && mode === 'scan' && !busy && !audioOpen,
    onCapture: () => {
      void takeStill();
    },
  });

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
      const file = blobToFile(pdf.output('blob'), timestampName('Scan', '.pdf'), 'PinIT Document Scan');
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
      if (blob.size > 0) onFileReady(blobToFile(blob, timestampName('Video', ext), 'PinIT Video Capture'));
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

  const fireShutter = () => {
    if (modeRef.current === 'video') {
      if (recording) stopVideo();
      else startVideo();
      return;
    }
    void takeStill();
  };

  const onShutter = () => {
    if (busy || countdown != null) return;
    if (!ready) {
      void startCamera(facing);
      return;
    }
    if (mode === 'video' || timerSec === 0) {
      fireShutter();
      return;
    }
    let left = timerSec;
    setCountdown(left);
    timerRef.current = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setCountdown(null);
        fireShutter();
        return;
      }
      setCountdown(left);
    }, 1000);
  };

  const deliverFile = (file: File) => {
    stopCamera();
    setAudioOpen(false);
    onFileReady(file);
  };

  const onLibrary = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) deliverFile(tagProtectFile(file, 'Upload'));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) deliverFile(tagProtectFile(file, 'Upload'));
  };

  const toggleFlash = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    const ok = await setTorch(track, next);
    setTorchOn(ok && next);
  };

  const cycleTimer = () => {
    setTimerSec((t) => (t === 0 ? 3 : t === 3 ? 10 : 0));
  };

  const statusLabel = recording
    ? 'Recording'
    : mode === 'scan' && ready
      ? scanHint || 'Position the document within the frame'
      : 'Camera Ready';

  return (
    <div
      className="protect-studio relative mx-auto w-full max-w-[420px] font-sans"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="on-dark relative aspect-[3/4] w-full overflow-hidden rounded-[28px] bg-[#111318] shadow-[0_18px_50px_rgba(0,0,0,0.35)] ring-1 ring-black/20">
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover ${ready ? '' : 'invisible'} ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
          style={{ filter: ready ? filterCss : undefined }}
          playsInline
          muted
        />

        {!ready && !audioOpen && (
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#5a7a9a_0%,#2a3a52_52%,#151a22_100%)]">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_28%,rgba(0,0,0,0.42)_100%)]" />
          </div>
        )}

        {flash && <div className="pointer-events-none absolute inset-0 bg-white/75" />}

        {showGrid && (
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="border border-white/20" />
            ))}
          </div>
        )}

        {mode !== 'scan' && mode !== 'portrait' && <FocusReticle />}

        {mode === 'portrait' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[62%] w-[58%] rounded-[46%] border border-white/50" />
          </div>
        )}

        {mode === 'scan' && (
          <div className="pointer-events-none absolute inset-[11%]">
            <div className="absolute inset-0 rounded-md border border-white/30" />
            <span className="absolute left-0 top-0 h-7 w-7 border-l-2 border-t-2 border-white" />
            <span className="absolute right-0 top-0 h-7 w-7 border-r-2 border-t-2 border-white" />
            <span className="absolute bottom-0 left-0 h-7 w-7 border-b-2 border-l-2 border-white" />
            <span className="absolute bottom-0 right-0 h-7 w-7 border-b-2 border-r-2 border-white" />
            <p className="absolute -top-7 left-0 right-0 text-center text-[11px] font-semibold text-white/90">
              Position the document within the frame
            </p>
          </div>
        )}

        {countdown != null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-7xl font-extrabold tabular-nums text-white drop-shadow-lg">{countdown}</span>
          </div>
        )}

        <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-full bg-black/45 p-1 backdrop-blur-md">
            {MODES.map((item) => {
              const Icon = item.icon;
              const active = mode === item.id && !audioOpen;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={recording}
                  onClick={() => {
                    if (item.id !== 'scan') setScanPages([]);
                    setAudioOpen(false);
                    setMode(item.id);
                  }}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-full px-1.5 py-1.5 text-[11px] font-semibold transition ${
                    active ? 'bg-white text-slate-900 shadow-sm' : 'text-white/80 hover:text-white'
                  }`}
                >
                  <Icon size={12} strokeWidth={2.2} />
                  {item.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!ready || !torchOk}
            onClick={() => void toggleFlash()}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full backdrop-blur-md ${
              torchOn ? 'bg-amber-400 text-black' : 'bg-black/45 text-white'
            } disabled:opacity-40`}
            aria-label="Flash"
          >
            <Flashlight size={15} />
          </button>
        </div>

        {recording && (
          <div className="absolute left-1/2 top-[4.25rem] flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-600/90 px-3 py-1 text-xs font-semibold tabular-nums text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            REC {String(Math.floor(recordSec / 60)).padStart(2, '0')}:{String(recordSec % 60).padStart(2, '0')}
          </div>
        )}

        <div className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-2xl bg-black/40 py-1 backdrop-blur-md">
          <div className="relative">
            <RailControl label="Filters" active={filter !== 'none' || filterOpen} onClick={() => setFilterOpen((o) => !o)}>
              <Sparkles size={16} />
            </RailControl>
            {filterOpen && (
              <div className="absolute right-[76px] top-0 w-28 overflow-hidden rounded-xl bg-black/80 py-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFilter(f.id);
                      setFilterOpen(false);
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-xs font-medium ${
                      filter === f.id ? 'text-sky-300' : 'text-white/85'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <RailControl label={timerSec ? `${timerSec}s` : 'Timer'} active={timerSec > 0} onClick={cycleTimer}>
            <Timer size={16} />
          </RailControl>
          <RailControl label="Grid" active={showGrid} onClick={() => setShowGrid((g) => !g)}>
            <Grid3x3 size={16} />
          </RailControl>
        </div>

        {error && (
          <div className="absolute inset-x-4 top-1/2 z-20 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/80 p-4 text-center text-sm text-white backdrop-blur-md">
            <p>{error}</p>
            <p className="mt-1 text-xs text-white/60">Camera access required. Tap Capture to start camera.</p>
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

        {audioOpen && (
          <div className="absolute inset-0 z-20 overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                className="rounded-full border border-white/15 bg-black/40 px-3 py-1 text-xs font-semibold text-white"
                onClick={() => setAudioOpen(false)}
              >
                Close
              </button>
            </div>
            <MediaRecorderPanel
              mode="audio"
              autoStart={false}
              onComplete={(file) => deliverFile(tagProtectFile(file, 'PinIT Audio Capture'))}
              onCancel={() => setAudioOpen(false)}
            />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent px-6 pb-5 pt-16">
          {mode === 'scan' && scanPages.length > 0 && (
            <div className="mb-3 flex items-center justify-between text-xs font-medium text-white">
              <span>
                {scanPages.length} page{scanPages.length === 1 ? '' : 's'}
                {scanPhase === 'locking' ? ' · locking' : ''}
              </span>
              <div className="flex items-center gap-3">
                {scanPhase === 'paused' && (
                  <button type="button" className="font-semibold text-white/80" onClick={armNextCapture}>
                    Next page
                  </button>
                )}
                <button type="button" className="font-semibold text-white" onClick={() => void finishScan()} disabled={busy}>
                  Done
                </button>
              </div>
            </div>
          )}

          <div className="mb-4 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
              <span className={`h-1.5 w-1.5 rounded-full ${recording ? 'bg-red-400' : 'bg-emerald-400'}`} />
              {statusLabel}
            </span>
          </div>

          <div className="grid grid-cols-3 items-end">
            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-black/45 text-white backdrop-blur-md"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Gallery — add a file"
              >
                <Images className="h-6 w-6" strokeWidth={1.8} />
              </button>
              <span className="pl-0.5 text-[11px] font-semibold text-white/90">Gallery</span>
              <button
                type="button"
                className="text-[10px] font-medium text-white/55 hover:text-white"
                onClick={() => {
                  if (recording) return;
                  stopCamera();
                  setAudioOpen(true);
                }}
              >
                Audio
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={onLibrary} />
            </div>

            <div className="flex justify-center pb-1">
              <button
                type="button"
                disabled={busy}
                onClick={onShutter}
                className={`relative flex h-[74px] w-[74px] items-center justify-center rounded-full border-[3px] border-white bg-transparent transition ${
                  shutterPulse ? 'scale-95' : ''
                }`}
                aria-label={
                  !ready
                    ? 'Open camera'
                    : mode === 'video'
                      ? recording
                        ? 'Stop recording'
                        : 'Start recording'
                      : mode === 'scan'
                        ? 'Scan page'
                        : 'Take photo'
                }
              >
                <span
                  className={`block rounded-full shadow-[0_0_0_4px_rgba(56,189,248,0.28)] transition-all ${
                    mode === 'video' && ready
                      ? recording
                        ? 'h-7 w-7 rounded-md bg-red-500 shadow-none'
                        : 'h-[58px] w-[58px] bg-red-500'
                      : 'h-[58px] w-[58px] bg-white'
                  }`}
                />
              </button>
            </div>

            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                disabled={recording}
                onClick={switchFacing}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md"
                aria-label="Switch camera"
              >
                <RefreshCw className="h-5 w-5" strokeWidth={2.2} />
              </button>
              <span className="pr-0.5 text-[11px] font-semibold text-white/90">Switch</span>
            </div>
          </div>
        </div>
      </div>
      {!ready && (
        <p className="mt-3 text-center text-xs font-medium text-slate-500">Tap the shutter to start the camera</p>
      )}
    </div>
  );
}
