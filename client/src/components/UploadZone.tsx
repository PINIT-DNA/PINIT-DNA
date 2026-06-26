import { useCallback, useState, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { Camera, Upload, ScanLine, X, Plus, FileText, Trash2 } from 'lucide-react';
import { jsPDF } from 'jspdf';

interface Props {
  onFileSelected: (file: File) => void;
  onGenerate: () => void;
  selectedFile: File | null;
}

// ─── File type config ──────────────────────────────────────────────────────────

const FILE_TYPES = [
  { label: 'IMAGE',   exts: ['.jpg','.jpeg','.png','.webp','.tiff','.gif','.bmp'], icon: '🖼️',  color: 'text-pink-400',   mime: 'image/*' },
  { label: 'PDF',     exts: ['.pdf'],                                              icon: '📄',  color: 'text-red-400',    mime: 'application/pdf' },
  { label: 'DOCX',    exts: ['.docx'],                                             icon: '📝',  color: 'text-blue-400',   mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { label: 'PPTX',    exts: ['.pptx'],                                             icon: '📊',  color: 'text-orange-400', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { label: 'TXT',     exts: ['.txt','.md','.log'],                                 icon: '📃',  color: 'text-gray-300',   mime: 'text/plain' },
  { label: 'CSV',     exts: ['.csv'],                                              icon: '📋',  color: 'text-green-400',  mime: 'text/csv' },
  { label: 'JSON',    exts: ['.json'],                                             icon: '🗃️',  color: 'text-yellow-400', mime: 'application/json' },
  { label: 'ZIP',     exts: ['.zip'],                                              icon: '🗜️',  color: 'text-purple-400', mime: 'application/zip' },
  { label: 'VIDEO',   exts: ['.mp4','.mov','.avi','.mkv','.webm'],                icon: '🎬',  color: 'text-cyan-400',   mime: 'video/*' },
  { label: 'AUDIO',   exts: ['.mp3','.wav','.flac','.ogg','.aac','.m4a'],         icon: '🎵',  color: 'text-indigo-400', mime: 'audio/*' },
];

// Build dropzone accept map from all types
const ACCEPT_MAP = FILE_TYPES.reduce<Record<string, string[]>>((acc, ft) => {
  acc[ft.mime] = ft.exts;
  return acc;
}, {});

function getFileIcon(file: File): string {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const mime = file.type.toLowerCase();
  for (const ft of FILE_TYPES) {
    if (ft.exts.includes(ext) || mime.startsWith(ft.mime.replace('*', ''))) return ft.icon;
  }
  return '📁';
}

function getFileTypeLabel(file: File): string {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const mime = file.type.toLowerCase();
  for (const ft of FILE_TYPES) {
    if (ft.exts.includes(ext) || mime.startsWith(ft.mime.replace('*', ''))) return ft.label;
  }
  return 'FILE';
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

const formatBytes = (b: number) =>
  b >= 1024 * 1024 * 1024
    ? `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
    : b >= 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(2)} MB`
    : `${(b / 1024).toFixed(1)} KB`;

// ─── Component ────────────────────────────────────────────────────────────────

export function UploadZone({ onFileSelected, onGenerate, selectedFile }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [buildingPdf, setBuildingPdf] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileReady = useCallback((file: File) => {
    onFileSelected(file);
    if (isImageFile(file)) {
      setPreview(URL.createObjectURL(file));
    } else {
      setPreview(null);
    }
    setScanMode(false);
    setCameraActive(false);
  }, [onFileSelected]);

  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      handleFileReady(file);
    },
    [handleFileReady]
  );

  const startCamera = async () => {
    setCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      setCameraActive(false);
      cameraInputRef.current?.click();
    }
  };

  // Capture a single page and add to scannedPages array
  const capturePage = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setScannedPages(prev => [...prev, dataUrl]);
  };

  // Single page capture (original behavior)
  const captureAndFinish = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopCamera();
        handleFileReady(file);
      }
    }, 'image/jpeg', 0.92);
  };

  // Combine all scanned pages into a single PDF
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
      const file = new File([blob], `scanned_${scannedPages.length}pages_${Date.now()}.pdf`, { type: 'application/pdf' });
      stopCamera();
      setScannedPages([]);
      handleFileReady(file);
    } catch {
      // fallback: just use last page as image
      captureAndFinish();
    }
    setBuildingPdf(false);
  };

  const removePage = (index: number) => {
    setScannedPages(prev => prev.filter((_, i) => i !== index));
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT_MAP,
    maxFiles: 1,
    maxSize: 500 * 1024 * 1024, // 500MB global ceiling
  });

  const fileIcon  = selectedFile ? getFileIcon(selectedFile) : '📁';
  const fileLabel = selectedFile ? getFileTypeLabel(selectedFile) : '';

  return (
    <div className="max-w-2xl mx-auto w-full">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-10"
      >
        <div className="text-6xl mb-4 dna-float">🧬</div>
        <h2 className="text-3xl font-bold text-white mb-2">
          Generate File DNA
        </h2>
        <p className="text-gray-400 text-sm max-w-md mx-auto">
          Upload any file to generate a 10-layer persistent fingerprint.
          Supports <span className="text-dna-400 font-medium">10 file types</span> — images, documents, media, archives and more.
        </p>
      </motion.div>

      {/* Hidden camera input (mobile fallback) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => { if (e.target.files?.[0]) handleFileReady(e.target.files[0]); }}
      />

      {/* Mode toggle: Upload / Scan */}
      {!selectedFile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.08 }}
          className="flex gap-2 mb-4"
        >
          <button
            onClick={() => { setScanMode(false); stopCamera(); }}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              !scanMode
                ? 'bg-dna-500/15 text-dna-400 border border-dna-500/30'
                : 'bg-bg-elevated text-gray-400 border border-bg-border hover:border-dna-500/20'
            }`}
          >
            <Upload size={14} /> Upload File
          </button>
          <button
            onClick={() => setScanMode(true)}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              scanMode
                ? 'bg-dna-500/15 text-dna-400 border border-dna-500/30'
                : 'bg-bg-elevated text-gray-400 border border-bg-border hover:border-dna-500/20'
            }`}
          >
            <ScanLine size={14} /> Scan Document
          </button>
        </motion.div>
      )}

      {/* ── SCAN MODE ── */}
      {scanMode && !selectedFile && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
        >
          {cameraActive ? (
            <div className="space-y-3">
              <div className="relative rounded-2xl overflow-hidden border-2 border-dna-500/30">
                <video ref={videoRef} className="w-full rounded-2xl" autoPlay playsInline muted />
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-6 border-2 border-dna-400/40 rounded-xl">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-dna-400 rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-dna-400 rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-dna-400 rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-dna-400 rounded-br-lg" />
                  </div>
                  <div className="absolute top-1/2 left-6 right-6 h-0.5 bg-dna-500/50 animate-pulse" />
                </div>
                {scannedPages.length > 0 && (
                  <div className="absolute top-3 right-3 bg-dna-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                    {scannedPages.length} {scannedPages.length === 1 ? 'page' : 'pages'}
                  </div>
                )}
                <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-dna-400 font-semibold drop-shadow-lg">
                  {scannedPages.length === 0 ? 'Align document within the frame' : `Page ${scannedPages.length + 1} — align next page`}
                </p>
              </div>

              {/* Scanned page thumbnails */}
              {scannedPages.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {scannedPages.map((page, i) => (
                    <div key={i} className="relative shrink-0 w-16 h-20 rounded-lg overflow-hidden border border-bg-border group">
                      <img src={page} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => removePage(i)} className="text-white"><Trash2 size={14} /></button>
                      </div>
                      <span className="absolute bottom-0.5 left-0 right-0 text-center text-[8px] text-white font-bold drop-shadow">{i + 1}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <button onClick={capturePage} className="bg-bg-elevated border border-bg-border text-white flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold hover:bg-bg-muted transition-colors">
                  <Plus size={16} /> Add Page
                </button>
                {scannedPages.length > 0 ? (
                  <button onClick={buildPdf} disabled={buildingPdf} className="btn-primary flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold">
                    <FileText size={16} /> {buildingPdf ? 'Building PDF...' : `Generate PDF (${scannedPages.length} pages)`}
                  </button>
                ) : (
                  <button onClick={captureAndFinish} className="btn-primary flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold">
                    <Camera size={16} /> Single Page
                  </button>
                )}
                <button onClick={() => { stopCamera(); setScanMode(false); setScannedPages([]); }} className="bg-bg-elevated border border-bg-border text-gray-400 hover:text-white px-4 py-3 rounded-xl text-sm font-semibold transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-bg-border bg-bg-card text-center py-14 px-6">
              <div className="w-16 h-16 rounded-2xl bg-dna-500/10 flex items-center justify-center mx-auto mb-4">
                <ScanLine size={28} className="text-dna-400" />
              </div>
              <p className="text-white font-semibold text-lg mb-5">Scan a Document</p>
              <div className="flex gap-3 max-w-xs mx-auto">
                <button onClick={startCamera} className="btn-primary flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold">
                  <Camera size={15} /> Open Camera
                </button>
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="bg-bg-elevated border border-bg-border text-gray-300 hover:text-white flex-1 py-3 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors"
                >
                  <Upload size={15} /> Gallery
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── UPLOAD MODE (Drop zone) ── */}
      {!scanMode && (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
      >
        <div
          {...getRootProps()}
          className={`
            relative rounded-2xl border-2 border-dashed cursor-pointer
            transition-all duration-300 overflow-hidden
            ${isDragActive
              ? 'border-dna-500 bg-dna-500/10 glow-purple'
              : selectedFile
              ? 'border-layer-complete bg-layer-complete/5 glow-green'
              : 'border-bg-border bg-bg-card hover:border-dna-500/50 hover:bg-bg-card/80'
            }
          `}
        >
          <input {...getInputProps()} />

          {selectedFile ? (
            <div className="flex flex-col sm:flex-row items-center gap-6 p-6">
              {/* Preview or icon */}
              <div className="relative shrink-0">
                {preview ? (
                  <img
                    src={preview}
                    alt="Preview"
                    className="w-36 h-36 object-cover rounded-xl border border-bg-border shadow-xl"
                  />
                ) : (
                  <div className="w-36 h-36 rounded-xl border border-bg-border bg-bg-surface shadow-xl flex flex-col items-center justify-center gap-2">
                    <span className="text-5xl">{fileIcon}</span>
                    <span className="mono text-xs text-dna-400 font-bold">{fileLabel}</span>
                  </div>
                )}
                <div className="absolute -top-2 -right-2 bg-layer-complete rounded-full p-1">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              {/* File info */}
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-layer-complete font-semibold text-sm">File Ready</p>
                  <span className="mono text-xs bg-dna-500/20 text-dna-400 px-2 py-0.5 rounded">
                    {fileLabel}
                  </span>
                </div>
                <p className="text-white font-medium text-lg truncate">{selectedFile.name}</p>
                <div className="flex gap-4 mt-2">
                  <span className="mono text-xs text-gray-400">{formatBytes(selectedFile.size)}</span>
                  <span className="mono text-xs text-gray-400">{selectedFile.type || 'unknown type'}</span>
                </div>
                <p className="text-gray-500 text-xs mt-3">Click or drop to change file</p>
              </div>
            </div>
          ) : (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 px-6">
              {isDragActive ? (
                <>
                  <div className="text-5xl mb-4">📂</div>
                  <p className="text-dna-400 font-semibold">Drop it here</p>
                </>
              ) : (
                <>
                  <div className="text-5xl mb-5">📁</div>
                  <p className="text-white font-semibold text-lg mb-1">
                    Drag & drop any file
                  </p>
                  <p className="text-gray-500 text-sm mb-5">or click to browse files</p>

                  {/* File type grid */}
                  <div className="grid grid-cols-5 gap-2 mb-4">
                    {FILE_TYPES.map((ft) => (
                      <div
                        key={ft.label}
                        className="flex flex-col items-center gap-1 bg-bg-border/50 rounded-lg px-2 py-2"
                      >
                        <span className="text-lg">{ft.icon}</span>
                        <span className={`mono text-[10px] font-bold ${ft.color}`}>{ft.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-gray-600 text-xs">Max 500MB · All file types supported</p>
                </>
              )}
            </div>
          )}
        </div>
      </motion.div>
      )}

      {/* Generate button */}
      {selectedFile && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 flex justify-center"
        >
          <button onClick={onGenerate} className="btn-primary text-base px-10 py-4">
            <span>Generate DNA Fingerprint</span>
            <span className="text-lg">→</span>
          </button>
        </motion.div>
      )}

      {/* Layer overview */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-10 grid grid-cols-2 sm:grid-cols-5 gap-3"
      >
        {[
          { icon: '🔐', label: 'Cryptographic Hash', num: 1 },
          { icon: '🏗️', label: 'Structural',          num: 2 },
          { icon: '👁️', label: 'Perceptual Hash',     num: 3 },
          { icon: '🎨', label: 'Semantic Analysis',   num: 4 },
          { icon: '🏷️', label: 'Metadata Provenance', num: 5 },
          { icon: '🔏', label: 'HMAC Signature',       num: 6 },
          { icon: '🧠', label: 'Behavioral Context',  num: 7 },
          { icon: '🔗', label: 'Relationship Graph',  num: 8 },
          { icon: '🌍', label: 'Origin Context',       num: 9 },
          { icon: '🌳', label: 'Evolution Tree',       num: 10 },
          { icon: '🤖', label: 'Deepfake Detection',  num: 11 },
          { icon: '🔲', label: 'DCT Watermark',       num: 12 },
          { icon: '⚖️', label: 'Legal Custody',        num: 13 },
          { icon: '🔑', label: 'Zero-Knowledge Proof', num: 14 },
          { icon: '👤', label: 'Biometric Bind',       num: 15 },
        ].map((l) => (
          <div key={l.num} className="card flex items-center gap-3 py-3 px-4 opacity-60">
            <span className="text-xl">{l.icon}</span>
            <div>
              <p className="mono text-xs text-dna-400">Layer {l.num}</p>
              <p className="text-xs text-gray-300 font-medium">{l.label}</p>
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
