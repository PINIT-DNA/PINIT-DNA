import { useState, useRef } from 'react';
import { Shield, Upload, User, Dna, CheckCircle, AlertTriangle, RefreshCw, FileSearch } from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';

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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleVerify = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
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
    setLoading(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-dna-500/20 flex items-center justify-center">
          <FileSearch size={20} className="text-dna-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Verify Leaked File</h1>
          <p className="text-xs text-gray-500">Upload any file to check if it contains a PINIT-DNA identity signature</p>
        </div>
      </div>

      {/* Upload area */}
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
          onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }}
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

      {/* Verify button */}
      <button
        onClick={handleVerify}
        disabled={!file || loading}
        className="btn btn-primary w-full mt-4"
      >
        {loading ? (
          <><RefreshCw size={14} className="animate-spin" /> Analyzing file...</>
        ) : (
          <><Shield size={14} /> Verify Identity</>
        )}
      </button>

      {/* Result */}
      {result && (
        <div className="mt-6">
          {result.found ? (
            <div className="card space-y-4">
              {/* Status header */}
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

              {/* Owner details */}
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

                  {/* Tamper status */}
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
      <div className="card mt-6">
        <h3 className="text-sm font-semibold text-white mb-3">How It Works</h3>
        <div className="space-y-2 text-2xs text-gray-500">
          <p>1. Every file uploaded to PINIT-DNA has the owner's identity cryptographically embedded inside it</p>
          <p>2. The signature is hidden using format-specific methods — metadata for PDF, custom XML for Office files, zero-width characters for text, LSB steganography for images</p>
          <p>3. When you upload a suspected leaked file here, the system scans for and extracts this hidden signature</p>
          <p>4. If found, it reveals who originally owned the file and whether it was modified after embedding</p>
          <p>5. Even if 90% of the file content is changed, the signature can often survive because it's placed in areas most editors don't touch</p>
        </div>
      </div>
    </div>
  );
}
