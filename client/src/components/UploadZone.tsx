import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';

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

  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      onFileSelected(file);
      // Only set image preview for images
      if (isImageFile(file)) {
        setPreview(URL.createObjectURL(file));
      } else {
        setPreview(null);
      }
    },
    [onFileSelected]
  );

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

      {/* Drop zone */}
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
        className="mt-10 grid grid-cols-2 sm:grid-cols-3 gap-3"
      >
        {[
          { icon: '🔐', label: 'Cryptographic Hash', num: 1 },
          { icon: '🏗️', label: 'Structural',          num: 2 },
          { icon: '👁️', label: 'Perceptual Hash',     num: 3 },
          { icon: '🎨', label: 'Semantic Analysis',   num: 4 },
          { icon: '🏷️', label: 'Metadata Provenance', num: 5 },
          { icon: '🔏', label: 'HMAC Signature',       num: 6 },
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
