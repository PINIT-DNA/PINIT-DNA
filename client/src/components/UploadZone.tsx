import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { Upload, ScanLine, Video, Mic, FileUp } from 'lucide-react';
import { DocumentScanner } from './DocumentScanner';
import { MediaRecorderPanel } from './MediaRecorderPanel';
import {
  ACCEPT_MAP,
  FILE_TYPES,
  formatBytes,
  getFileIcon,
  getFileTypeLabel,
  isAudioFile,
  isImageFile,
  isPdfFile,
  isVideoFile,
} from '../lib/file-type-utils';

export type CaptureMode = 'upload' | 'scan' | 'video' | 'audio';

interface Props {
  onFileSelected: (file: File | null) => void;
  onGenerate: () => void;
  selectedFile: File | null;
}

const CAPTURE_MODES: { id: CaptureMode; label: string; icon: typeof Upload; desc: string }[] = [
  { id: 'upload', label: 'Upload', icon: Upload, desc: 'Any file type' },
  { id: 'scan', label: 'Scan', icon: ScanLine, desc: 'Camera → PDF' },
  { id: 'video', label: 'Video', icon: Video, desc: 'Record clip' },
  { id: 'audio', label: 'Audio', icon: Mic, desc: 'Record voice' },
];

function FilePreview({ file }: { file: File }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isImageFile(file) || isVideoFile(file) || isAudioFile(file)) {
      const url = URL.createObjectURL(file);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setObjectUrl(null);
    return undefined;
  }, [file]);

  const icon = getFileIcon(file);
  const label = getFileTypeLabel(file);

  if (objectUrl && isImageFile(file)) {
    return (
      <img
        src={objectUrl}
        alt="Preview"
        className="w-full h-full object-cover rounded-xl"
      />
    );
  }

  if (objectUrl && isVideoFile(file)) {
    return (
      <video
        src={objectUrl}
        className="w-full h-full object-cover rounded-xl"
        controls
        playsInline
      />
    );
  }

  if (objectUrl && isAudioFile(file)) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4 bg-bg-surface rounded-xl">
        <span className="text-4xl">{icon}</span>
        <audio src={objectUrl} controls className="w-full max-w-[200px]" />
      </div>
    );
  }

  if (isPdfFile(file)) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-red-500/5 rounded-xl border border-red-500/20">
        <span className="text-5xl">📄</span>
        <span className="mono text-xs text-red-400 font-bold">PDF</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-bg-surface rounded-xl">
      <span className="text-5xl">{icon}</span>
      <span className="mono text-xs text-dna-400 font-bold">{label}</span>
    </div>
  );
}

export function UploadZone({ onFileSelected, onGenerate, selectedFile }: Props) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('upload');

  const handleFileReady = useCallback(
    (file: File) => {
      onFileSelected(file);
      setCaptureMode('upload');
    },
    [onFileSelected],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (file) handleFileReady(file);
    },
    [handleFileReady],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT_MAP,
    maxFiles: 1,
    maxSize: 500 * 1024 * 1024,
  });

  const fileLabel = selectedFile ? getFileTypeLabel(selectedFile) : '';

  return (
    <div className="max-w-3xl mx-auto w-full">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <div className="text-6xl mb-4 dna-float">🧬</div>
        <h2 className="text-3xl font-bold text-white mb-2">Generate File DNA</h2>
        <p className="text-gray-400 text-sm max-w-lg mx-auto">
          Upload, scan, or record a file to protect it with PINIT-DNA.
        </p>
      </motion.div>

      {!selectedFile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.06 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5"
        >
          {CAPTURE_MODES.map(({ id, label, icon: Icon, desc }) => (
            <button
              key={id}
              type="button"
              onClick={() => setCaptureMode(id)}
              className={`rounded-xl border p-3 text-left transition-all ${
                captureMode === id
                  ? 'bg-dna-500/12 border-dna-500/40 shadow-sm'
                  : 'bg-bg-card border-bg-border hover:border-dna-500/25'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={15} className={captureMode === id ? 'text-dna-500' : 'text-gray-400'} />
                <span className={`text-sm font-semibold ${captureMode === id ? 'text-dna-500' : 'text-white'}`}>
                  {label}
                </span>
              </div>
              <p className="text-2xs text-gray-500">{desc}</p>
            </button>
          ))}
        </motion.div>
      )}

      {!selectedFile && captureMode === 'scan' && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <DocumentScanner
            onScanComplete={handleFileReady}
            onCancel={() => setCaptureMode('upload')}
            subtitle="Auto-capture documents — multi-page builds a PDF"
          />
        </motion.div>
      )}

      {!selectedFile && captureMode === 'video' && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <MediaRecorderPanel
            mode="video"
            onComplete={handleFileReady}
            onCancel={() => setCaptureMode('upload')}
          />
        </motion.div>
      )}

      {!selectedFile && captureMode === 'audio' && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <MediaRecorderPanel
            mode="audio"
            onComplete={handleFileReady}
            onCancel={() => setCaptureMode('upload')}
          />
        </motion.div>
      )}

      {!selectedFile && captureMode === 'upload' && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <div
            {...getRootProps()}
            className={`
              relative rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-300 overflow-hidden
              ${isDragActive
                ? 'border-dna-500 bg-dna-500/10 glow-purple'
                : 'border-bg-border bg-bg-card hover:border-dna-500/50 hover:bg-bg-card/80'
              }
            `}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center py-14 px-6">
              {isDragActive ? (
                <>
                  <FileUp size={48} className="text-dna-400 mb-3" />
                  <p className="text-dna-400 font-semibold">Drop file here</p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-2xl bg-dna-500/10 flex items-center justify-center mb-4">
                    <Upload size={28} className="text-dna-400" />
                  </div>
                  <p className="text-white font-semibold text-lg mb-1">Drag & drop any file</p>
                  <p className="text-gray-500 text-sm mb-5">or click to browse</p>
                  <div className="grid grid-cols-5 gap-2 mb-4 max-w-md w-full">
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
                  <p className="text-gray-600 text-xs">Max 500 MB</p>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {selectedFile && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border-2 border-layer-complete bg-layer-complete/5 glow-green overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row items-stretch gap-0">
            <div className="sm:w-48 h-48 sm:h-auto shrink-0 p-4">
              <div className="w-full h-full min-h-[160px] rounded-xl border border-bg-border overflow-hidden shadow-lg">
                <FilePreview file={selectedFile} />
              </div>
            </div>
            <div className="flex-1 p-6 flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-layer-complete font-semibold text-sm">Capture Ready</p>
                <span className="mono text-xs bg-dna-500/20 text-dna-400 px-2 py-0.5 rounded">{fileLabel}</span>
              </div>
              <p className="text-white font-medium text-lg truncate">{selectedFile.name}</p>
              <div className="flex flex-wrap gap-4 mt-2">
                <span className="mono text-xs text-gray-400">{formatBytes(selectedFile.size)}</span>
                <span className="mono text-xs text-gray-400">{selectedFile.type || 'unknown'}</span>
              </div>
              <button
                type="button"
                onClick={() => onFileSelected(null)}
                className="mt-4 text-xs text-gray-500 hover:text-dna-400 transition-colors text-left w-fit"
              >
                ← Choose a different capture method
              </button>
            </div>
          </div>
        </motion.div>
      )}

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

    </div>
  );
}
