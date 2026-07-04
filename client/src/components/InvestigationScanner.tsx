import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImageIcon, RefreshCw, X } from 'lucide-react';
import { useAutoDocumentCapture, type AutoScanPhase } from '../hooks/useAutoDocumentCapture';
import {
  captureInvestigationInput,
  normalizeScannerBlob,
  ScannerQualityGateError,
  ScannerStageTimeoutError,
} from '../lib/document-capture-pipeline';
import { runTimedStage } from '../lib/scanner-async-utils';
import { extractVideoFrameBlob, isImageFile, isVideoFile } from '../lib/scanner-media-utils';

function friendlyHint(phase: AutoScanPhase): string {
  switch (phase) {
    case 'warming':
      return 'Position the document in view';
    case 'searching':
      return 'Align the evidence inside the frame';
    case 'locking':
      return 'Hold steady…';
    case 'captured':
      return 'Captured';
    case 'paused':
      return 'Ready for next capture';
    default:
      return 'Point your camera at the evidence';
  }
}

export interface InvestigationScannerProps {
  onScanComplete: (file: File) => void;
  /** Fired when capture file is ready — immediately before investigation POST */
  onProcessingStart: () => void;
  onCancel: () => void;
  onCaptureError?: (message: string) => void;
}

export function InvestigationScanner({
  onScanComplete,
  onProcessingStart,
  onCancel,
  onCaptureError,
}: InvestigationScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const autoStartedRef = useRef(false);
  const capturingRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const resetCaptureState = useCallback(() => {
    capturingRef.current = false;
    setProcessing(false);
    setProgressLabel(null);
  }, []);

  const failCapture = useCallback((message: string) => {
    resetCaptureState();
    setCaptureError(message);
    onCaptureError?.(message);
  }, [onCaptureError, resetCaptureState]);

  const startCamera = useCallback(async () => {
    setCameraReady(false);
    setCaptureError(null);
    try {
      await runTimedStage('getUserMedia', async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
          },
          audio: false,
        });
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' }] as unknown as MediaTrackConstraintSet[],
            });
          } catch { /* unsupported */ }
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          await videoRef.current.play();
          setCameraReady(true);
        }
      }, 15_000);
    } catch {
      galleryRef.current?.click();
    }
  }, []);

  useEffect(() => {
    if (!autoStartedRef.current) {
      autoStartedRef.current = true;
      void startCamera();
    }
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const deliverFile = useCallback(
    (blob: Blob, name?: string) => {
      // Same File shape as Upload — investigation page calls unifiedInvestigateStream.
      // IMG_ prefix matches camera-upload naming (not a separate scanner API).
      const file = new File(
        [blob],
        name ?? `IMG_${Date.now()}.jpg`,
        { type: blob.type || 'image/jpeg' },
      );
      console.time('[Scanner] startInvestigation');
      onProcessingStart();
      onScanComplete(file);
      console.timeEnd('[Scanner] startInvestigation');
    },
    [onScanComplete, onProcessingStart],
  );

  const processCapture = useCallback(async () => {
    if (!videoRef.current || capturingRef.current) return;
    capturingRef.current = true;
    setProcessing(true);
    setCaptureError(null);
    setProgressLabel('Capturing frames…');

    setFlash(true);
    window.setTimeout(() => setFlash(false), 200);

    try {
      const result = await captureInvestigationInput(videoRef.current, {
        burstCount: 3,
        jpegQuality: 0.97,
        relaxedQualityGate: true,
        onProgress: (_phase, label) => setProgressLabel(label),
      });

      stopCamera();

      if (!result?.blob) {
        failCapture('Could not capture — try again with better lighting');
        return;
      }

      setProgressLabel('Starting investigation…');
      deliverFile(result.blob);
      resetCaptureState();
    } catch (err) {
      stopCamera();
      const msg = err instanceof ScannerQualityGateError
        ? (err.message || 'Hold steady and ensure the document is well lit')
        : err instanceof ScannerStageTimeoutError
          ? 'Capture took too long — tap Capture to retry'
          : 'Capture failed — please try again';
      console.error('[Scanner] processCapture failed', err);
      failCapture(msg);
    }
  }, [deliverFile, failCapture, resetCaptureState, stopCamera]);

  const handleAutoCapture = useCallback(() => {
    void processCapture();
  }, [processCapture]);

  const { phase } = useAutoDocumentCapture(videoRef, {
    enabled: cameraReady && !processing,
    onCapture: handleAutoCapture,
    pauseAfterCapture: false,
    profile: 'forensic',
  });

  const handleGallery = async (f: File) => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    setProcessing(true);
    setCaptureError(null);
    setProgressLabel('Loading file…');
    stopCamera();

    try {
      if (isVideoFile(f)) {
        setProgressLabel('Extracting video frame…');
        const frame = await extractVideoFrameBlob(f);
        if (!frame) {
          failCapture('Could not read that video — try another file');
          return;
        }
        const normalized = await normalizeScannerBlob(frame, {
          jpegQuality: 0.97,
          relaxedQualityGate: true,
          investigationFast: true,
          onProgress: (_step, label) => setProgressLabel(label),
        });
        if (normalized) {
          deliverFile(normalized.blob);
          resetCaptureState();
          return;
        }
      }

      // Gallery / file pick — identical to Upload: pass the original File bytes through.
      // No extra normalization (that would diverge from the upload investigation path).
      if (isImageFile(f)) {
        setProgressLabel('Starting investigation…');
        deliverFile(f, f.name);
        resetCaptureState();
        return;
      }

      deliverFile(f, f.name);
      resetCaptureState();
    } catch (err) {
      const msg = err instanceof ScannerQualityGateError
        ? (err.message || 'Image quality too low — try again')
        : err instanceof ScannerStageTimeoutError
          ? 'Processing took too long — try a smaller image'
          : 'Could not process that file';
      console.error('[Scanner] handleGallery failed', err);
      failCapture(msg);
    }
  };

  const hint = processing && progressLabel
    ? progressLabel
    : friendlyHint(phase);
  const frameActive = phase === 'locking' || phase === 'warming';

  return (
    <div className="space-y-4">
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,application/pdf,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleGallery(f);
          e.target.value = '';
        }}
      />

      {captureError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2">
          <p className="text-xs text-red-300 flex-1">{captureError}</p>
          <button
            type="button"
            onClick={() => { setCaptureError(null); void startCamera(); }}
            className="text-xs text-white font-semibold flex items-center gap-1 shrink-0"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      <div className="relative w-full mx-auto max-w-lg aspect-[3/4] sm:aspect-[4/3] rounded-2xl overflow-hidden bg-black border border-bg-border">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          playsInline
          muted
        />

        {!cameraReady && !processing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90">
            <div className="w-8 h-8 rounded-full border-2 border-dna-400 border-t-transparent animate-spin" />
          </div>
        )}

        {processing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20 px-4 gap-2">
            <div className="w-8 h-8 rounded-full border-2 border-dna-400 border-t-transparent animate-spin" />
            <p className="text-sm text-dna-300 font-medium text-center">{progressLabel ?? 'Processing…'}</p>
          </div>
        )}

        <div
          className={`absolute inset-0 pointer-events-none transition-opacity duration-150 ${
            flash ? 'bg-white/40 opacity-100' : 'opacity-0'
          }`}
        />

        <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
          <div
            className={`relative w-full max-w-[300px] aspect-[3/4] rounded-lg border-2 transition-colors duration-300 ${
              frameActive ? 'border-white/70' : 'border-white/35'
            }`}
          >
            <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-2 border-l-2 border-white/80 rounded-tl" />
            <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-2 border-r-2 border-white/80 rounded-tr" />
            <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-2 border-l-2 border-white/80 rounded-bl" />
            <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-2 border-r-2 border-white/80 rounded-br" />
          </div>
        </div>

        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pt-10 pb-4">
          <p className="text-center text-sm text-white/90 font-medium">{hint}</p>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white/80 hover:text-white"
          aria-label="Close camera"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          disabled={processing}
          className="flex-1 py-3 rounded-xl border border-bg-border bg-bg-elevated text-sm font-semibold text-gray-300 hover:text-white flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <ImageIcon size={16} /> Gallery
        </button>
        <button
          type="button"
          onClick={() => void processCapture()}
          disabled={!cameraReady || processing}
          className="flex-[2] btn btn-primary py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Camera size={16} /> Capture
        </button>
      </div>
    </div>
  );
}
