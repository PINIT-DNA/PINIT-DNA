import { useState, useRef } from 'react';
import { Shield, Upload, User, Dna, CheckCircle, AlertTriangle, RefreshCw, FileSearch, Camera, ScanLine, Eye } from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { createWorker } from 'tesseract.js';

interface VerifyResult {
  found: boolean;
  valid?: boolean;
  tampered?: boolean;
  identity?: {
    dnaId: string;
    vaultId: string;
    ownerUserId: string;
    ownerEmail?: string;
    ownerName?: string;
  };
  message: string;
}

export function VerifyLeakedFilePage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [mode, setMode] = useState<'upload' | 'scan'>('upload');
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<any>(null);

  const handleVerify = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setScanResult(null);

    if (mode === 'scan') {
      // OCR mode: extract text from scanned image → search vault by content
      try {
        setOcrProgress('Initializing OCR engine...');
        const worker = await createWorker('eng');
        setOcrProgress('Reading text from image...');
        const { data: ocrData } = await worker.recognize(file);
        await worker.terminate();

        const extractedText = ocrData.text?.trim();
        if (!extractedText || extractedText.length < 10) {
          setResult({ found: false, message: 'Could not extract readable text from the scan. Try a clearer photo with more text visible.' });
          setLoading(false);
          setOcrProgress(null);
          return;
        }

        setOcrProgress(`Extracted ${extractedText.split(/\s+/).length} words — searching vault...`);

        const resp = await api.post(`${API_BASE_URL}/vault/scan-verify`, { ocrText: extractedText });
        const scanData = resp.data as any;

        if (scanData.found) {
          setScanResult(scanData);
          setResult({
            found: true,
            valid: true,
            tampered: false,
            identity: scanData.identity,
            message: scanData.message,
          });
        } else {
          setResult({ found: false, message: scanData.message || 'No matching document found in vault.' });
        }
      } catch {
        setResult({ found: false, message: 'Scan verification failed. Please try again.' });
      }
      setOcrProgress(null);
    } else {
      // Upload mode: send file to verify-identity endpoint
      try {
        const formData = new FormData();
        formData.append('image', file);
        const { data } = await api.post(`${API_BASE_URL}/vault/verify-identity`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setResult(data as VerifyResult);
      } catch {
        setResult({ found: false, message: 'Failed to verify file. Please try again.' });
      }
    }
    setLoading(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setPreview(null); }
  };

  const handleFileSelect = (f: File) => {
    setFile(f);
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  };

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
      // Fallback: open native camera capture
      cameraRef.current?.click();
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        const captured = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
        handleFileSelect(captured);
        setPreview(canvas.toDataURL('image/jpeg'));
        stopCamera();
      }
    }, 'image/jpeg', 0.92);
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const handleReset = () => {
    setFile(null); setResult(null); setPreview(null); stopCamera();
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-dna-500/20 flex items-center justify-center">
          <FileSearch size={20} className="text-dna-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Verify Leaked File</h1>
          <p className="text-xs text-gray-500">Upload or scan any file to check if it contains a PINIT-DNA identity signature</p>
        </div>
      </div>

      {/* Mode Toggle */}
      {!result && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setMode('upload'); stopCamera(); }}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              mode === 'upload'
                ? 'bg-dna-500/15 text-dna-400 border border-dna-500/30'
                : 'bg-bg-elevated text-gray-400 border border-bg-border hover:border-dna-500/20'
            }`}
          >
            <Upload size={14} />
            Upload File
          </button>
          <button
            onClick={() => { setMode('scan'); setFile(null); setPreview(null); }}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              mode === 'scan'
                ? 'bg-dna-500/15 text-dna-400 border border-dna-500/30'
                : 'bg-bg-elevated text-gray-400 border border-bg-border hover:border-dna-500/20'
            }`}
          >
            <ScanLine size={14} />
            Scan Document
          </button>
        </div>
      )}

      {/* Upload Mode */}
      {mode === 'upload' && !result && (
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="card border-2 border-dashed border-bg-border hover:border-dna-500/50 transition-colors cursor-pointer text-center py-12"
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
          />
          {file ? (
            <div>
              <CheckCircle size={32} className="text-green-400 mx-auto mb-3" />
              <p className="text-sm font-semibold text-white">{file.name}</p>
              <p className="text-2xs text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB · {file.type || 'Unknown type'}</p>
              <p className="text-2xs text-dna-400 mt-2">Click to change file</p>
            </div>
          ) : (
            <div>
              <Upload size={32} className="text-gray-500 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Drop a file here or click to upload</p>
              <p className="text-2xs text-gray-600 mt-1">Supports all 10 file types: PDF, DOCX, XLSX, PPTX, Images, TXT, CSV, Audio, Video, ZIP</p>
            </div>
          )}
        </div>
      )}

      {/* Scan Mode */}
      {mode === 'scan' && !result && (
        <div className="space-y-3">
          {/* Hidden native camera input (fallback for mobile) */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
          />

          {/* Camera viewfinder */}
          {cameraActive ? (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden border-2 border-dna-500/30">
                <video ref={videoRef} className="w-full rounded-xl" autoPlay playsInline muted />
                {/* Scan overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-4 border-2 border-dna-400/40 rounded-lg">
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-dna-400 rounded-tl-md" />
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-dna-400 rounded-tr-md" />
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-dna-400 rounded-bl-md" />
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-dna-400 rounded-br-md" />
                  </div>
                  <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-dna-500/50 animate-pulse" />
                </div>
                <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-dna-400 font-semibold">
                  Position the document within the frame
                </p>
              </div>
              {/* Capture + Cancel buttons */}
              <div className="flex gap-2">
                <button onClick={capturePhoto} className="btn btn-primary flex-1">
                  <Camera size={14} /> Capture
                </button>
                <button onClick={stopCamera} className="btn btn-secondary flex-[0.5]">
                  Cancel
                </button>
              </div>
            </div>
          ) : preview ? (
            /* Captured preview */
            <div className="relative rounded-xl overflow-hidden border border-bg-border">
              <img src={preview} alt="Scanned" className="w-full rounded-xl" />
              <div className="absolute top-2 right-2">
                <button onClick={handleReset} className="bg-bg-surface/80 backdrop-blur text-gray-400 hover:text-white rounded-lg p-1.5 transition">
                  <RefreshCw size={14} />
                </button>
              </div>
              {file && (
                <div className="p-3 bg-bg-elevated border-t border-bg-border">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-green-400" />
                    <span className="text-xs font-semibold text-white">{file.name}</span>
                    <span className="text-2xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Start scan buttons */
            <div className="card text-center py-10 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-dna-500/10 flex items-center justify-center mx-auto">
                <ScanLine size={28} className="text-dna-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Scan a Document</p>
                <p className="text-2xs text-gray-500 mt-1">
                  Point your camera at any document to check its ownership
                </p>
              </div>
              <div className="flex gap-2 max-w-xs mx-auto">
                <button onClick={startCamera} className="btn btn-primary flex-1">
                  <Camera size={14} /> Open Camera
                </button>
                <button onClick={() => cameraRef.current?.click()} className="btn btn-secondary flex-1">
                  <Upload size={14} /> Gallery
                </button>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <span className="text-2xs bg-bg-elevated border border-bg-border rounded-full px-2.5 py-1 text-gray-500">Auto-detect owner</span>
                <span className="text-2xs bg-bg-elevated border border-bg-border rounded-full px-2.5 py-1 text-gray-500">Tamper check</span>
                <span className="text-2xs bg-bg-elevated border border-bg-border rounded-full px-2.5 py-1 text-gray-500">Instant results</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Verify button */}
      {!result && (
        <button
          onClick={handleVerify}
          disabled={!file || loading}
          className="btn btn-primary w-full mt-4"
        >
          {loading ? (
            <><RefreshCw size={14} className="animate-spin" /> {ocrProgress || (mode === 'scan' ? 'Scanning for identity...' : 'Analyzing file...')}</>
          ) : (
            <><Shield size={14} /> {mode === 'scan' ? 'Scan & Verify Identity' : 'Verify Identity'}</>
          )}
        </button>
      )}

      {/* Result */}
      {result && (
        <div className="mt-2">
          <button onClick={handleReset} className="btn btn-secondary btn-sm mb-4">
            <RefreshCw size={13} /> Scan Another File
          </button>

          {/* Scan match info */}
          {scanResult?.found && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-dna-500/10 border border-dna-500/30 mb-4">
              <Eye size={20} className="text-dna-400" />
              <div className="flex-1">
                <p className="text-sm font-bold text-dna-400">Matched via Document Scan (OCR)</p>
                <p className="text-2xs text-gray-500 mt-0.5">
                  {scanResult.matchScore}% text similarity · {scanResult.matchMethod} · Original: {scanResult.originalFile?.fileName}
                </p>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                scanResult.matchScore >= 70 ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'
              }`}>
                {scanResult.matchScore}%
              </span>
            </div>
          )}

          {result.found ? (
            <div className="card space-y-4">
              <div className={`flex items-center gap-3 p-4 rounded-xl ${
                result.valid ? 'bg-green-500/10 border border-green-500/30' : 'bg-orange-500/10 border border-orange-500/30'
              }`}>
                {result.valid ? (
                  <CheckCircle size={24} className="text-green-400" />
                ) : (
                  <AlertTriangle size={24} className="text-orange-400" />
                )}
                <div>
                  <p className={`text-sm font-bold ${result.valid ? 'text-green-400' : 'text-orange-400'}`}>
                    {result.valid ? 'Identity Verified' : 'Signature Found — Possible Tampering'}
                  </p>
                  <p className="text-2xs text-gray-500 mt-0.5">{result.message}</p>
                </div>
              </div>

              {result.identity && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <User size={14} className="text-dna-400" /> Original File Owner
                  </h3>
                  <div className="bg-bg-elevated rounded-xl p-4 border border-bg-border space-y-2">
                    {result.identity.ownerName && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Owner Name</span>
                        <span className="text-xs text-white font-semibold">{result.identity.ownerName}</span>
                      </div>
                    )}
                    {result.identity.ownerEmail && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Owner Email</span>
                        <span className="text-xs text-dna-400">{result.identity.ownerEmail}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">Owner User ID</span>
                      <span className="text-xs text-white font-mono">{result.identity.ownerUserId}</span>
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Dna size={14} className="text-dna-400" /> File Identity
                  </h3>
                  <div className="bg-bg-elevated rounded-xl p-4 border border-bg-border space-y-2">
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">DNA Record ID</span>
                      <span className="text-xs text-white font-mono">{result.identity.dnaId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">Vault ID</span>
                      <span className="text-xs text-white font-mono">{result.identity.vaultId}</span>
                    </div>
                  </div>

                  <div className={`p-3 rounded-xl border ${
                    result.tampered
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-green-500/10 border-green-500/30'
                  }`}>
                    <p className={`text-xs font-semibold ${result.tampered ? 'text-red-400' : 'text-green-400'}`}>
                      {result.tampered
                        ? 'File has been MODIFIED after original embedding. The content was changed but the identity signature partially survived.'
                        : 'File is UNMODIFIED. The identity signature is intact and verified — this is the original file from the owner.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card text-center py-8">
              <Shield size={32} className="text-gray-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-400">No PINIT-DNA Signature Found</p>
              <p className="text-2xs text-gray-600 mt-2 max-w-md mx-auto">
                This file does not contain a PINIT-DNA identity signature. It may not have been protected by PINIT-DNA,
                or the signature region was completely destroyed during modification.
              </p>
            </div>
          )}
        </div>
      )}

      {/* How it works */}
      {!result && (
        <div className="card mt-6">
          <h3 className="text-sm font-semibold text-white mb-3">How It Works</h3>
          <div className="space-y-2 text-2xs text-gray-500">
            <p>1. Every file uploaded to PINIT-DNA has the owner's identity cryptographically embedded inside it</p>
            <p>2. The signature is hidden using format-specific methods — metadata for PDF, custom XML for Office files, zero-width characters for text, LSB steganography for images</p>
            <p>3. Upload a file or scan a document with your camera to check for hidden signatures</p>
            <p>4. If found, it reveals who originally owned the file and whether it was modified after embedding</p>
            <p>5. Even if 90% of the file content is changed, the signature can often survive because it's placed in areas most editors don't touch</p>
          </div>
        </div>
      )}
    </div>
  );
}
