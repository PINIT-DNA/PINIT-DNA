import { useState, useRef, useCallback } from 'react';
import { Shield, Upload, User, Dna, CheckCircle, AlertTriangle, RefreshCw, FileSearch, ScanLine, Eye, Link2, MapPin, Clock, Fingerprint } from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { createWorker } from 'tesseract.js';
import { DocumentScanner } from '../components/DocumentScanner';

interface AccessEntry {
  timestamp: string;
  action: string;
  ipAddress?: string;
  country?: string;
  city?: string;
  region?: string;
  device?: string;
  browser?: string;
  os?: string;
  riskLevel?: string;
}

interface VerifyResult {
  found: boolean;
  valid?: boolean;
  tampered?: boolean;
  detectionMethod?: string;
  leakVector?: string;
  confidence?: number;
  identity?: {
    dnaId?: string;
    vaultId?: string;
    ownerUserId?: string;
    ownerEmail?: string;
    ownerName?: string;
    ownerShortId?: string;
    originalFilename?: string;
    dnaCreatedAt?: string;
  };
  shareLink?: {
    token?: string;
    shareUrl?: string;
    filename?: string;
    createdAt?: string;
    expiresAt?: string;
    linkType?: string;
    recipientLabel?: string;
    recipientEmail?: string;
  };
  recipient?: {
    label?: string;
    recipientCode?: string;
    email?: string;
    firstAccessAt?: string;
    lastAccessAt?: string;
    knownCountries?: string[];
  };
  watermark?: { code?: string; extractionMethod?: string };
  tep?: { code?: string; valid?: boolean };
  forensic?: {
    signals?: string[];
    shareToken?: string;
    pHashSimilarity?: number;
    signatureMethod?: string;
  };
  accessHistory?: AccessEntry[];
  message: string;
}

const METHOD_LABELS: Record<string, string> = {
  EMBEDDED_IDENTITY: 'Embedded Identity Signature',
  EXACT_HASH: 'Exact File Hash (SHA-256)',
  NORMALIZED_HASH: 'Same Pixel Content (Tampered Re-save)',
  TEP_EXPORT: 'Tracked Export Package (Download)',
  PINIT_VAULT_SIGNATURE: 'Share-Viewer Screenshot / OCR',
  WATERMARK: 'Forensic Watermark',
  NEAR_DUPLICATE_PHASH: 'Visual Fingerprint (pHash)',
};

const VECTOR_LABELS: Record<string, string> = {
  ORIGINAL_FILE: 'Original protected file',
  DOWNLOAD_REUPLOAD: 'Share-link download re-upload',
  SCREENSHOT: 'Screenshot / screen capture',
  RECORDING: 'Screen recording / re-encoded copy',
  COPY_PASTE: 'Modified copy',
  UNKNOWN: 'Unknown leak path',
};

export function VerifyLeakedFilePage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [mode, setMode] = useState<'upload' | 'scan'>('upload');
  const inputRef = useRef<HTMLInputElement>(null);
  const [ocrProgress, setOcrProgress] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<any>(null);

  const runVerify = useCallback(async (targetFile: File, verifyMode: 'upload' | 'scan') => {
    setLoading(true);
    setResult(null);
    setScanResult(null);
    setFile(targetFile);

    if (verifyMode === 'scan') {
      try {
        setOcrProgress('Initializing OCR engine...');
        const worker = await createWorker('eng');
        setOcrProgress('Reading text from image...');
        const { data: ocrData } = await worker.recognize(targetFile);
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
      try {
        const formData = new FormData();
        formData.append('image', targetFile);
        const { data } = await api.post(`${API_BASE_URL}/vault/verify-identity`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000,
        });
        setResult(data as VerifyResult);
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string; message?: string } } })
          ?.response?.data?.error
          ?? (err as { response?: { data?: { message?: string } } })?.response?.data?.message
          ?? (err instanceof Error ? err.message : 'Failed to verify file. Please try again.');
        setResult({ found: false, message: msg });
      }
    }
    setLoading(false);
  }, []);

  const handleVerify = async () => {
    if (!file) return;
    await runVerify(file, mode);
  };

  const handleScanComplete = useCallback(async (captured: File) => {
    await runVerify(captured, 'scan');
  }, [runVerify]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); }
  };

  const handleFileSelect = (f: File) => {
    setFile(f);
  };

  const handleReset = () => {
    setFile(null); setResult(null);
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
            onClick={() => { setMode('upload'); }}
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
            onClick={() => { setMode('scan'); setFile(null); }}
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

      {/* Scan Mode — auto-capture + auto-verify */}
      {mode === 'scan' && !result && (
        <div className="space-y-3">
          {loading ? (
            <div className="card text-center py-12">
              <RefreshCw size={32} className="text-dna-400 mx-auto mb-3 animate-spin" />
              <p className="text-sm font-semibold text-white">Verifying scanned document…</p>
              <p className="text-2xs text-gray-500 mt-1">{ocrProgress ?? 'Running OCR and vault search'}</p>
            </div>
          ) : (
            <DocumentScanner
              captureMode="single"
              onScanComplete={handleScanComplete}
              onCancel={handleReset}
              subtitle="Camera opens automatically — document is captured and verified when detected"
            />
          )}
        </div>
      )}

      {/* Verify button (upload mode only — scan auto-verifies) */}
      {!result && mode === 'upload' && (
        <button
          onClick={handleVerify}
          disabled={!file || loading}
          className="btn btn-primary w-full mt-4"
        >
          {loading ? (
            <><RefreshCw size={14} className="animate-spin" /> Analyzing file…</>
          ) : (
            <><Shield size={14} /> Verify Identity</>
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
                result.tampered ? 'bg-orange-500/10 border border-orange-500/30' : 'bg-green-500/10 border border-green-500/30'
              }`}>
                {result.tampered ? (
                  <AlertTriangle size={24} className="text-orange-400" />
                ) : (
                  <CheckCircle size={24} className="text-green-400" />
                )}
                <div className="flex-1">
                  <p className={`text-sm font-bold ${result.tampered ? 'text-orange-400' : 'text-green-400'}`}>
                    {result.tampered ? 'Leak Detected — Source Identified' : 'Identity Verified'}
                  </p>
                  <p className="text-2xs text-gray-500 mt-0.5">{result.message}</p>
                </div>
                {result.confidence != null && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-dna-500/15 text-dna-400">
                    {result.confidence}% confidence
                  </span>
                )}
              </div>

              {/* Detection summary */}
              <div className="grid grid-cols-2 gap-2">
                {result.detectionMethod && (
                  <div className="bg-bg-elevated rounded-lg px-3 py-2">
                    <p className="text-2xs text-gray-500 uppercase tracking-wide">Detection Method</p>
                    <p className="text-xs text-white font-mono mt-0.5">
                      {METHOD_LABELS[result.detectionMethod] ?? result.detectionMethod}
                    </p>
                  </div>
                )}
                {result.leakVector && (
                  <div className="bg-bg-elevated rounded-lg px-3 py-2">
                    <p className="text-2xs text-gray-500 uppercase tracking-wide">Likely Leak Vector</p>
                    <p className="text-xs text-amber-400 font-semibold mt-0.5">
                      {VECTOR_LABELS[result.leakVector] ?? result.leakVector}
                    </p>
                  </div>
                )}
              </div>

              {result.identity && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <User size={14} className="text-dna-400" /> Original File Owner
                  </h3>
                  <div className="bg-bg-elevated rounded-xl p-4 border border-bg-border space-y-2">
                    {result.identity.ownerShortId && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">PINIT ID</span>
                        <span className="text-xs text-amber-400 font-mono font-semibold">{result.identity.ownerShortId}</span>
                      </div>
                    )}
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
                    {result.identity.originalFilename && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Original Filename</span>
                        <span className="text-xs text-white font-mono truncate max-w-[200px]">{result.identity.originalFilename}</span>
                      </div>
                    )}
                    {result.identity.dnaCreatedAt && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">DNA Created</span>
                        <span className="text-xs text-gray-300">{new Date(result.identity.dnaCreatedAt).toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Dna size={14} className="text-dna-400" /> File Identity
                  </h3>
                  <div className="bg-bg-elevated rounded-xl p-4 border border-bg-border space-y-2">
                    {result.identity.dnaId && (
                      <div className="flex justify-between gap-2">
                        <span className="text-xs text-gray-500 shrink-0">DNA Record ID</span>
                        <span className="text-xs text-dna-400 font-mono text-right break-all">{result.identity.dnaId}</span>
                      </div>
                    )}
                    {result.identity.vaultId && (
                      <div className="flex justify-between gap-2">
                        <span className="text-xs text-gray-500 shrink-0">Vault ID</span>
                        <span className="text-xs text-white font-mono text-right break-all">{result.identity.vaultId}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Recipient */}
              {(result.recipient || result.shareLink?.recipientLabel || result.shareLink?.recipientEmail) && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <User size={14} className="text-dna-400" /> Share Recipient
                  </h3>
                  <div className="bg-bg-elevated rounded-xl p-4 border border-bg-border space-y-2">
                    {(result.recipient?.label || result.shareLink?.recipientLabel) && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Recipient Label</span>
                        <span className="text-xs text-white font-semibold">
                          {result.recipient?.label ?? result.shareLink?.recipientLabel}
                        </span>
                      </div>
                    )}
                    {result.recipient?.recipientCode && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Recipient Code</span>
                        <span className="text-xs text-dna-400 font-mono">{result.recipient.recipientCode}</span>
                      </div>
                    )}
                    {(result.recipient?.email || result.shareLink?.recipientEmail) && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Recipient Email</span>
                        <span className="text-xs text-dna-400">
                          {result.recipient?.email ?? result.shareLink?.recipientEmail}
                        </span>
                      </div>
                    )}
                    {result.recipient?.firstAccessAt && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">First Access</span>
                        <span className="text-xs text-gray-300">{new Date(result.recipient.firstAccessAt).toLocaleString()}</span>
                      </div>
                    )}
                    {result.recipient?.lastAccessAt && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Last Access</span>
                        <span className="text-xs text-gray-300">{new Date(result.recipient.lastAccessAt).toLocaleString()}</span>
                      </div>
                    )}
                    {result.recipient?.knownCountries && result.recipient.knownCountries.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Known Countries</span>
                        <span className="text-xs text-white">{result.recipient.knownCountries.join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Share link source */}
              {result.shareLink?.token && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Link2 size={14} className="text-dna-400" /> Source Share Link
                  </h3>
                  <div className="bg-bg-elevated rounded-xl p-4 border border-bg-border space-y-2">
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">Share Token</span>
                      <span className="text-xs text-dna-400 font-mono">{result.shareLink.token}</span>
                    </div>
                    {result.shareLink.filename && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Shared File</span>
                        <span className="text-xs text-white font-mono truncate max-w-[200px]">{result.shareLink.filename}</span>
                      </div>
                    )}
                    {result.shareLink.createdAt && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Link Created</span>
                        <span className="text-xs text-gray-300">{new Date(result.shareLink.createdAt).toLocaleString()}</span>
                      </div>
                    )}
                    {result.shareLink.expiresAt && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Link Expires</span>
                        <span className="text-xs text-gray-300">{new Date(result.shareLink.expiresAt).toLocaleString()}</span>
                      </div>
                    )}
                    {result.shareLink.recipientLabel && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Intended Recipient</span>
                        <span className="text-xs text-white">{result.shareLink.recipientLabel}</span>
                      </div>
                    )}
                    <a
                      href={result.shareLink.shareUrl ?? `/s/${result.shareLink.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-2xs text-dna-400 hover:text-dna-300 underline mt-1 inline-block"
                    >
                      View share link →
                    </a>
                  </div>
                </div>
              )}

              {/* Watermark / TEP */}
              {(result.watermark?.code || result.tep?.code) && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Fingerprint size={14} className="text-dna-400" /> Tracking Markers
                  </h3>
                  <div className="bg-bg-elevated rounded-xl p-4 border border-bg-border space-y-2">
                    {result.watermark?.code && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">Watermark Code</span>
                        <span className="text-xs text-white font-mono">{result.watermark.code}</span>
                      </div>
                    )}
                    {result.tep?.code && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">TEP Code</span>
                        <span className="text-xs text-white font-mono">{result.tep.code}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Access history */}
              {result.accessHistory && result.accessHistory.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <MapPin size={14} className="text-dna-400" /> Share Access History
                  </h3>
                  <div className="bg-bg-elevated rounded-xl border border-bg-border overflow-hidden">
                    <div className="max-h-48 overflow-y-auto divide-y divide-bg-border">
                      {result.accessHistory.map((entry, i) => (
                        <div key={i} className="px-4 py-2.5 space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-2xs font-semibold text-dna-400">{entry.action}</span>
                            <span className="text-2xs text-gray-500 flex items-center gap-1">
                              <Clock size={10} />
                              {new Date(entry.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-2xs text-gray-400">
                            {[entry.city, entry.region, entry.country].filter(Boolean).join(', ') || 'Location unknown'}
                            {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                            {entry.device ? ` · ${entry.device}` : ''}
                            {entry.browser ? ` · ${entry.browser}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className={`p-3 rounded-xl border ${
                result.tampered
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-green-500/10 border-green-500/30'
              }`}>
                <p className={`text-xs font-semibold ${result.tampered ? 'text-red-400' : 'text-green-400'}`}>
                  {result.tampered
                    ? 'This file is a leaked derivative — not the original vault file. Content was captured or exported outside the vault after sharing.'
                    : 'File identity is intact — this appears to be the original protected file from the owner.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="card text-center py-8">
              <Shield size={32} className="text-gray-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-400">No PINIT-DNA Signature Found</p>
              <p className="text-2xs text-gray-600 mt-2 max-w-md mx-auto">
                No embedded identity, watermark, share-link token, or visual fingerprint was found.
                For screenshots: include the filename bar and <strong className="text-gray-500">Token:</strong> line
                (Link Intelligence or Secure Viewer page). For downloads: upload the actual shared file
                (e.g. the PDF from the Download button), not a screenshot named Screenshot.png.
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
            <p>1. <strong>Downloaded file</strong> — TEP markers, watermarks, exact SHA-256 hash, or embedded identity</p>
            <p>2. <strong>Tampered file</strong> — damaged HMAC, changed bytes (normalized hash), partial identity, or visual fingerprint</p>
            <p>3. <strong>Screenshot</strong> — OCR reads Link Intelligence (<code className="text-gray-400">/link/token</code>) or Secure Viewer token + filename → owner, recipient, access logs</p>
            <p>4. <strong>Original vault file</strong> — embedded identity inside the decrypted file (not encrypted .enc storage)</p>
            <p>5. Tampered results show <span className="text-orange-400">Leak Detected</span> with owner details even when content was modified</p>
          </div>
        </div>
      )}
    </div>
  );
}
