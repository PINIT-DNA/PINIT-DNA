import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ScanLine, X, Plus, FileText, Trash2, Zap, RefreshCw } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useAutoDocumentCapture } from '../hooks/useAutoDocumentCapture';
import {
  captureForensicScan,
  captureInvestigationInput,
  validateCaptureQuality,
  cropToGuideRegion,
  imageDataToJpegBlob,
  ScannerQualityGateError,
  ScannerStageTimeoutError,
  scanTypeLabel,
  type ScanType,
} from '../lib/document-capture-pipeline';
import { runTimedStage } from '../lib/scanner-async-utils';
import { preferContinuousFocus, releaseMediaStream, openCameraStream, cameraErrorMessage } from '../lib/camera-stream';

function useIsMobileViewport() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const fn = () => setMobile(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return mobile;
}

interface DocumentScannerProps {
  onScanComplete: (file: File) => void;
  onCancel?: () => void;
  subtitle?: string;
  /** Open camera immediately when scan view appears (default: true) */
  autoStart?: boolean;
  /** single = auto-finish after first capture; multi = collect pages for PDF */
  captureMode?: 'single' | 'multi';
  /**
   * Unified Investigation — instant single-frame capture, no burst/normalize overlay.
   * Same file → investigation API as upload. Other pages keep full forensic pipeline.
   * @deprecated Use unifiedInvestigation instead — enables full normalization pipeline.
   */
  quickCapture?: boolean;
  /**
   * Unified Investigation Center — scanner is an input source for the same backend pipeline as upload.
   * Runs full client-side normalization; does NOT change upload behavior elsewhere.
   */
  unifiedInvestigation?: boolean;
}

export function DocumentScanner({
  onScanComplete,
  onCancel,
  subtitle,
  autoStart = true,
  captureMode = 'multi',
  quickCapture = false,
  unifiedInvestigation = false,
}: DocumentScannerProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [buildingPdf, setBuildingPdf] = useState(false);
  const [flashCapture, setFlashCapture] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [normalizing, setNormalizing] = useState(false);
  const [normalizeStep, setNormalizeStep] = useState<string | null>(null);
  const [detectedScanType, setDetectedScanType] = useState<ScanType | null>(null);
  const enhanceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoStartedRef = useRef(false);
  const isMobile = useIsMobileViewport();

  if (!enhanceCanvasRef.current) {
    enhanceCanvasRef.current = document.createElement('canvas');
  }

  const captureProfile =
    unifiedInvestigation && captureMode === 'single'
      ? ('forensic' as const)
      : captureMode === 'single'
        ? (isMobile ? 'screen' as const : 'forensic' as const)
        : 'fast' as const;

  const onNormalizeProgress = useCallback((_: string, label: string) => {
    setNormalizeStep(label);
  }, []);

  const stopCamera = useCallback(() => {
    releaseMediaStream(streamRef.current, videoRef.current);
    streamRef.current = null;
    setCameraActive(false);
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraActive(true);
    setCameraReady(false);
    setCaptureError(null);
    // Release any prior stream before opening a new one
    releaseMediaStream(streamRef.current, videoRef.current);
    streamRef.current = null;
    try {
      const stream = await openCameraStream();
      // User left scanner while permission prompt / getUserMedia was pending
      if (!mountedRef.current) {
        releaseMediaStream(stream);
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      await preferContinuousFocus(track);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        await videoRef.current.play();
        if (!mountedRef.current) {
          stopCamera();
          return;
        }
        setCameraReady(true);
      } else {
        releaseMediaStream(stream);
        streamRef.current = null;
        setCameraActive(false);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setCameraActive(false);
      setCameraReady(false);
      setCaptureError(
        cameraErrorMessage(err, 'Use Upload above to protect a file from your device.'),
      );
    }
  }, [stopCamera]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void startCamera();
    }
    // pagehide covers mobile app background / navigation away
    window.addEventListener('pagehide', stopCamera);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', stopCamera);
      stopCamera();
    };
  }, [autoStart, startCamera, stopCamera]);

  const grabFrameDataUrl = useCallback((): string | null => {
    if (!videoRef.current) return null;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoRef.current, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  const finishWithBlob = useCallback(
    (blob: Blob, scanType?: ScanType) => {
      const file = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
      stopCamera();
      setScannedPages([]);
      setCaptureError(null);
      setNormalizing(false);
      setNormalizeStep(null);
      setDetectedScanType(scanType ?? null);
      onScanComplete(file);
    },
    [onScanComplete, stopCamera],
  );

  const captureAndFinish = useCallback(async () => {
    if (!videoRef.current) return;
    setCaptureError(null);
    setNormalizeStep(null);

    // Legacy fast path — only when explicitly requested (not used by Unified Investigation)
    if (captureMode === 'single' && quickCapture && !unifiedInvestigation) {
      try {
        const canvas = enhanceCanvasRef.current!;
        let imageData = cropToGuideRegion(videoRef.current, canvas);
        if (!imageData) {
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0);
            imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          }
        }
        if (!imageData) {
          setCaptureError('Capture failed — try again');
          return;
        }
        setFlashCapture(true);
        window.setTimeout(() => setFlashCapture(false), 280);
        const blob = await imageDataToJpegBlob(imageData, 0.92);
        if (blob) finishWithBlob(blob);
      } catch {
        setCaptureError('Capture failed — try again');
      }
      return;
    }

    const useForensicPipeline = captureMode === 'single';
    if (useForensicPipeline) {
      try {
        const canvas = enhanceCanvasRef.current!;
        const preview = cropToGuideRegion(videoRef.current, canvas);
        if (preview && !unifiedInvestigation) {
          const gate = validateCaptureQuality(preview);
          if (!gate.ok) {
            setCaptureError(gate.reason ?? 'Capture quality too low');
            return;
          }
        }
        setNormalizing(true);
        setCaptureError(null);
        const result = unifiedInvestigation
          ? await runTimedStage('captureInvestigationInput', () =>
            captureInvestigationInput(videoRef.current!, {
              burstCount: 3,
              jpegQuality: 0.97,
              relaxedQualityGate: true,
              onProgress: onNormalizeProgress,
            }), 28_000)
          : await captureForensicScan(videoRef.current!, { burstCount: 5, jpegQuality: 0.97 });
        if (result) {
          setFlashCapture(true);
          window.setTimeout(() => setFlashCapture(false), 280);
          finishWithBlob(result.blob, result.scanType);
          return;
        }
      } catch (err) {
        if (err instanceof ScannerQualityGateError) {
          setCaptureError(err.message);
        } else if (err instanceof ScannerStageTimeoutError) {
          setCaptureError('Capture timed out — tap Capture to retry');
        } else {
          setCaptureError('Capture failed — try again with better lighting');
        }
        return;
      } finally {
        setNormalizing(false);
        setNormalizeStep(null);
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) finishWithBlob(blob);
    }, 'image/jpeg', captureMode === 'single' ? 0.96 : 0.92);
  }, [finishWithBlob, captureMode, quickCapture, unifiedInvestigation, onNormalizeProgress]);

  const capturePage = useCallback(() => {
    const dataUrl = grabFrameDataUrl();
    if (!dataUrl) return;
    setFlashCapture(true);
    window.setTimeout(() => setFlashCapture(false), 280);
    setScannedPages((prev) => [...prev, dataUrl]);
  }, [grabFrameDataUrl]);

  const capturePageRef = useRef(capturePage);
  capturePageRef.current = capturePage;

  const handleAutoCapture = useCallback(() => {
    setFlashCapture(true);
    window.setTimeout(() => setFlashCapture(false), 280);

    if (captureMode === 'single') {
      void captureAndFinish();
      return;
    }
    capturePageRef.current();
  }, [captureMode, captureAndFinish]);

  const { phase, progress, hint, armed, armNextCapture, resetCapture, notifyCaptured } =
    useAutoDocumentCapture(videoRef, {
      enabled: cameraActive && cameraReady,
      onCapture: handleAutoCapture,
      pauseAfterCapture: captureMode === 'multi',
      profile: captureProfile,
    });

  const handleManualPage = () => {
    capturePage();
    notifyCaptured();
  };

  const buildPdf = async () => {
    if (scannedPages.length === 0) return;
    setBuildingPdf(true);
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < scannedPages.length; i++) {
        if (i > 0) pdf.addPage();
        pdf.addImage(scannedPages[i]!, 'JPEG', 0, 0, pageW, pageH);
      }

      const blob = pdf.output('blob');
      const file = new File(
        [blob],
        `scanned_${scannedPages.length}pages_${Date.now()}.pdf`,
        { type: 'application/pdf' },
      );
      stopCamera();
      setScannedPages([]);
      onScanComplete(file);
    } catch {
      captureAndFinish();
    }
    setBuildingPdf(false);
  };

  const removePage = (index: number) => {
    setScannedPages((prev) => prev.filter((_, i) => i !== index));
    resetCapture();
  };

  const handleCancel = () => {
    stopCamera();
    setScannedPages([]);
    onCancel?.();
  };

  const scanLineClass =
    phase === 'locking'
      ? 'bg-dna-400 animate-pulse'
      : phase === 'captured'
        ? 'bg-green-400'
        : 'bg-dna-500/50 animate-pulse';

  return (
    <div className="space-y-3">
      {cameraActive ? (
        <div className="space-y-3">
          <div className="relative w-full mx-auto max-w-lg aspect-[4/3] max-h-[min(42vh,280px)] sm:max-h-[340px] rounded-2xl overflow-hidden border-2 border-dna-500/30 bg-black">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              autoPlay
              playsInline
              muted
            />
            {!cameraReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90 z-10">
                <RefreshCw size={24} className="text-dna-400 animate-spin" />
                <span className="text-xs text-gray-400">Starting camera…</span>
              </div>
            )}
            {normalizing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 z-20 px-4">
                <RefreshCw size={22} className="text-dna-400 animate-spin" />
                <span className="text-xs text-dna-300 font-medium text-center">
                  {unifiedInvestigation ? 'Preparing investigation input…' : 'Normalizing capture…'}
                </span>
                {normalizeStep && (
                  <span className="text-[10px] text-gray-400 text-center">{normalizeStep}</span>
                )}
              </div>
            )}
            <div
              className={`absolute inset-0 pointer-events-none transition-colors duration-200 ${
                flashCapture ? 'bg-white/35' : ''
              }`}
            />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-3 sm:p-4">
              <div
                className={`relative w-[92%] max-w-[280px] aspect-[3/4] border-2 rounded-lg transition-colors duration-300 ${
                  phase === 'locking' ? 'border-dna-400' : 'border-dna-400/50'
                }`}
              >
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-dna-400 rounded-tl-md" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-dna-400 rounded-tr-md" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-dna-400 rounded-bl-md" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-dna-400 rounded-br-md" />
                <div className={`absolute top-1/2 left-2 right-2 h-0.5 -translate-y-1/2 ${scanLineClass}`} />
              </div>
            </div>

            {scannedPages.length > 0 && (
              <div className="absolute top-3 right-3 bg-dna-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                {scannedPages.length} {scannedPages.length === 1 ? 'page' : 'pages'}
              </div>
            )}

            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur rounded-full px-2.5 py-1 z-10">
              <Zap size={12} className={phase === 'locking' ? 'text-dna-300' : 'text-dna-400'} />
              <span className="text-[10px] font-semibold text-dna-300">
                {unifiedInvestigation
                  ? 'Investigation scan'
                  : captureMode === 'single'
                    ? (isMobile ? 'Screen scan' : 'Smart capture')
                    : 'Auto-scan'}
              </span>
            </div>
            {captureMode === 'single' && detectedScanType && !normalizing && (
              <div className="absolute top-3 right-3 bg-black/50 backdrop-blur rounded-full px-2.5 py-1 z-10">
                <span className="text-[10px] text-gray-300">{scanTypeLabel(detectedScanType)}</span>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent pt-6 pb-2 px-3 z-10">
              <p className="text-center text-[11px] text-white font-medium drop-shadow-lg leading-snug">{hint}</p>
              {captureError && (
                <p className="text-center text-[10px] text-orange-300 mt-1">{captureError}</p>
              )}
              {(phase === 'locking' || phase === 'warming') && (
                <div className="mt-1.5 mx-auto max-w-[180px] h-1 rounded-full bg-white/20 overflow-hidden">
                  <div
                    className="h-full bg-dna-400 transition-all duration-100"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {scannedPages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {scannedPages.map((page, i) => (
                <div key={i} className="relative shrink-0 w-16 h-20 rounded-lg overflow-hidden border border-bg-border group">
                  <img src={page} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <button type="button" onClick={() => removePage(i)} className="text-white">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <span className="absolute bottom-0.5 left-0 right-0 text-center text-[8px] text-white font-bold drop-shadow">
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {captureMode === 'single' && (
              <button
                type="button"
                onClick={() => { void captureAndFinish(); }}
                className="btn btn-primary flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold"
              >
                <Camera size={16} /> Capture Now
              </button>
            )}
            {captureMode === 'multi' && (
              <>
                {!armed && scannedPages.length > 0 && (
                  <button
                    type="button"
                    onClick={armNextCapture}
                    className="btn btn-primary flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold"
                  >
                    <ScanLine size={16} /> Scan Next Page
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleManualPage}
                  className="bg-bg-elevated border border-bg-border text-white flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold hover:bg-bg-muted transition-colors"
                >
                  <Plus size={16} /> Manual Page
                </button>
                {scannedPages.length > 0 ? (
                  <button
                    type="button"
                    onClick={buildPdf}
                    disabled={buildingPdf}
                    className="btn btn-primary flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold"
                  >
                    <FileText size={16} />
                    {buildingPdf ? 'Building PDF…' : `Done (${scannedPages.length} pages)`}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={captureAndFinish}
                    className="btn btn-secondary flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold"
                  >
                    <Camera size={16} /> Manual Capture
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={handleCancel}
              className="bg-bg-elevated border border-bg-border text-gray-400 hover:text-white px-4 py-3 rounded-xl text-sm font-semibold transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="card text-center py-10 space-y-4 border-2 border-dashed border-bg-border">
          <div className="w-16 h-16 rounded-2xl bg-dna-500/10 flex items-center justify-center mx-auto">
            <ScanLine size={28} className="text-dna-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Scan a Document</p>
            {subtitle ? (
              <p className="text-2xs text-gray-500 mt-1">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex gap-2 max-w-xs mx-auto">
            <button type="button" onClick={() => { setCaptureError(null); void startCamera(); }} className="btn btn-primary flex-1">
              <Camera size={14} /> Open Camera
            </button>
          </div>
          {captureError && (
            <p className="text-2xs text-orange-300 max-w-sm mx-auto px-2">{captureError}</p>
          )}
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {unifiedInvestigation ? (
              <>
                <span className="text-2xs bg-dna-500/10 border border-dna-500/20 rounded-full px-2.5 py-1 text-dna-400">Same pipeline as upload</span>
                <span className="text-2xs bg-bg-elevated border border-bg-border rounded-full px-2.5 py-1 text-gray-500">Auto normalize</span>
                <span className="text-2xs bg-bg-elevated border border-bg-border rounded-full px-2.5 py-1 text-gray-500">Screens · prints · video</span>
              </>
            ) : (
              <>
                <span className="text-2xs bg-dna-500/10 border border-dna-500/20 rounded-full px-2.5 py-1 text-dna-400">Auto-capture</span>
                <span className="text-2xs bg-bg-elevated border border-bg-border rounded-full px-2.5 py-1 text-gray-500">Multi-page PDF</span>
                <span className="text-2xs bg-bg-elevated border border-bg-border rounded-full px-2.5 py-1 text-gray-500">Full investigation</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
