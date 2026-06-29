import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Upload, ScanLine, X, Plus, FileText, Trash2, Zap } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useAutoDocumentCapture } from '../hooks/useAutoDocumentCapture';

interface DocumentScannerProps {
  onScanComplete: (file: File) => void;
  onCancel?: () => void;
  subtitle?: string;
  /** Open camera immediately when scan view appears (default: true) */
  autoStart?: boolean;
  /** single = auto-finish after first capture; multi = collect pages for PDF */
  captureMode?: 'single' | 'multi';
}

export function DocumentScanner({
  onScanComplete,
  onCancel,
  subtitle,
  autoStart = true,
  captureMode = 'multi',
}: DocumentScannerProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [buildingPdf, setBuildingPdf] = useState(false);
  const [flashCapture, setFlashCapture] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const autoStartedRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraActive(true);
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      setCameraActive(false);
      setCameraReady(false);
      cameraInputRef.current?.click();
    }
  }, []);

  useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startCamera();
    }
  }, [autoStart, startCamera]);

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
    (blob: Blob) => {
      const file = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
      stopCamera();
      setScannedPages([]);
      onScanComplete(file);
    },
    [onScanComplete, stopCamera],
  );

  const capturePage = useCallback(() => {
    const dataUrl = grabFrameDataUrl();
    if (!dataUrl) return;
    setFlashCapture(true);
    window.setTimeout(() => setFlashCapture(false), 280);
    setScannedPages((prev) => [...prev, dataUrl]);
  }, [grabFrameDataUrl]);

  const capturePageRef = useRef(capturePage);
  capturePageRef.current = capturePage;

  const captureAndFinish = useCallback(() => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) finishWithBlob(blob);
    }, 'image/jpeg', 0.92);
  }, [finishWithBlob]);

  const handleAutoCapture = useCallback(() => {
    setFlashCapture(true);
    window.setTimeout(() => setFlashCapture(false), 280);

    if (captureMode === 'single') {
      captureAndFinish();
      return;
    }
    capturePageRef.current();
  }, [captureMode, captureAndFinish]);

  const { phase, progress, hint, armed, armNextCapture, resetCapture, notifyCaptured } =
    useAutoDocumentCapture(videoRef, {
      enabled: cameraActive && cameraReady,
      onCapture: handleAutoCapture,
      pauseAfterCapture: captureMode === 'multi',
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

  const handleGallery = (f: File) => {
    stopCamera();
    setScannedPages([]);
    onScanComplete(f);
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
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleGallery(e.target.files[0]); }}
      />

      {cameraActive ? (
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden border-2 border-dna-500/30">
            <video ref={videoRef} className="w-full rounded-2xl" autoPlay playsInline muted />
            <div
              className={`absolute inset-0 pointer-events-none transition-colors duration-200 ${
                flashCapture ? 'bg-white/35' : ''
              }`}
            />
            <div className="absolute inset-0 pointer-events-none">
              <div
                className={`absolute inset-6 border-2 rounded-xl transition-colors duration-300 ${
                  phase === 'locking' ? 'border-dna-400' : 'border-dna-400/40'
                }`}
              >
                <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-dna-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-dna-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-dna-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-dna-400 rounded-br-lg" />
              </div>
              <div className={`absolute top-1/2 left-6 right-6 h-0.5 ${scanLineClass}`} />
            </div>

            {scannedPages.length > 0 && (
              <div className="absolute top-3 right-3 bg-dna-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                {scannedPages.length} {scannedPages.length === 1 ? 'page' : 'pages'}
              </div>
            )}

            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur rounded-full px-2.5 py-1">
              <Zap size={12} className={phase === 'locking' ? 'text-dna-300' : 'text-dna-400'} />
              <span className="text-[10px] font-semibold text-dna-300">Auto-scan</span>
            </div>

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent pt-8 pb-3 px-4">
              <p className="text-center text-xs text-white font-semibold drop-shadow-lg">{hint}</p>
              {phase === 'locking' && (
                <div className="mt-2 mx-auto max-w-[200px] h-1 rounded-full bg-white/20 overflow-hidden">
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
            <p className="text-2xs text-gray-500 mt-1">
              {subtitle ?? 'Camera opens automatically — hold document in frame to capture'}
            </p>
          </div>
          <div className="flex gap-2 max-w-xs mx-auto">
            <button type="button" onClick={startCamera} className="btn btn-primary flex-1">
              <Camera size={14} /> Open Camera
            </button>
            <button type="button" onClick={() => cameraInputRef.current?.click()} className="btn btn-secondary flex-1">
              <Upload size={14} /> Gallery
            </button>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <span className="text-2xs bg-dna-500/10 border border-dna-500/20 rounded-full px-2.5 py-1 text-dna-400">Auto-capture</span>
            <span className="text-2xs bg-bg-elevated border border-bg-border rounded-full px-2.5 py-1 text-gray-500">Multi-page PDF</span>
            <span className="text-2xs bg-bg-elevated border border-bg-border rounded-full px-2.5 py-1 text-gray-500">Full investigation</span>
          </div>
        </div>
      )}
    </div>
  );
}
