import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { Upload, ScanLine, Video, Mic, FileUp, MapPin, RotateCcw, Fingerprint } from 'lucide-react';
import { DocumentScanner } from './DocumentScanner';
import { MediaRecorderPanel } from './MediaRecorderPanel';
import {
  ACCEPT_MAP,
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
  locationTrackingEnabled: boolean;
  onLocationTrackingChange: (enabled: boolean) => void;
}

const CAPTURE_MODES: { id: CaptureMode; label: string; icon: typeof Upload }[] = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'scan', label: 'Scan', icon: ScanLine },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'audio', label: 'Audio', icon: Mic },
];

const MAX_BYTES = 500 * 1024 * 1024;

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

  if (objectUrl && isImageFile(file)) {
    return <img src={objectUrl} alt="" className="w-full h-full object-cover rounded-xl" />;
  }
  if (objectUrl && isVideoFile(file)) {
    return <video src={objectUrl} className="w-full h-full object-cover rounded-xl" controls playsInline />;
  }
  if (objectUrl && isAudioFile(file)) {
    return (
      <div className="w-full h-full flex items-center justify-center p-4 bg-bg-surface rounded-xl">
        <audio src={objectUrl} controls className="w-full" />
      </div>
    );
  }
  if (isPdfFile(file)) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-bg-surface rounded-xl text-5xl">
        {icon}
      </div>
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-bg-surface rounded-xl text-5xl">
      {icon}
    </div>
  );
}

export function UploadZone({
  onFileSelected,
  onGenerate,
  selectedFile,
  locationTrackingEnabled,
  onLocationTrackingChange,
}: Props) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('upload');

  const handleFileReady = useCallback(
    (file: File) => {
      onFileSelected(file);
      setCaptureMode('upload');
    },
    [onFileSelected],
  );

  const onDrop = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (file) handleFileReady(file);
    },
    [handleFileReady],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT_MAP,
    maxFiles: 1,
    maxSize: MAX_BYTES,
  });

  const fileLabel = selectedFile ? getFileTypeLabel(selectedFile) : '';

  return (
    <div className="max-w-3xl mx-auto w-full px-2 sm:px-0">
      {!selectedFile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5"
        >
          {CAPTURE_MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setCaptureMode(id)}
              aria-label={label}
              className={`btn flex-col gap-2 min-h-[72px] py-3 ${
                captureMode === id ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <Icon size={20} />
              <span className="text-xs font-semibold">{label}</span>
            </button>
          ))}
        </motion.div>
      )}

      {!selectedFile && captureMode === 'scan' && (
        <DocumentScanner onScanComplete={handleFileReady} onCancel={() => setCaptureMode('upload')} />
      )}

      {!selectedFile && captureMode === 'video' && (
        <MediaRecorderPanel mode="video" onComplete={handleFileReady} onCancel={() => setCaptureMode('upload')} />
      )}

      {!selectedFile && captureMode === 'audio' && (
        <MediaRecorderPanel mode="audio" onComplete={handleFileReady} onCancel={() => setCaptureMode('upload')} />
      )}

      {!selectedFile && captureMode === 'upload' && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <div
            {...getRootProps()}
            className={`
              relative rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-300
              flex items-center justify-center min-h-[200px] sm:min-h-[240px]
              ${isDragActive
                ? 'border-dna-500 bg-dna-500/10 glow-purple'
                : 'border-bg-border bg-bg-card hover:border-dna-500/50'
              }
            `}
          >
            <input {...getInputProps()} />
            {isDragActive ? (
              <FileUp size={48} className="text-dna-400" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-dna-500/10 flex items-center justify-center">
                <Upload size={28} className="text-dna-400" />
              </div>
            )}
          </div>
        </motion.div>
      )}

      {selectedFile && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border border-layer-complete/40 bg-bg-card overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row">
            <div className="sm:w-44 h-44 shrink-0 p-3">
              <FilePreview file={selectedFile} />
            </div>
            <div className="flex-1 p-4 flex flex-col justify-center gap-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-xs bg-dna-500/20 text-dna-400 px-2 py-1 rounded">{fileLabel}</span>
                <span className="mono text-xs text-gray-500 truncate max-w-[200px]">{selectedFile.name}</span>
                <span className="mono text-xs text-gray-600">{formatBytes(selectedFile.size)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => onFileSelected(null)} className="btn btn-secondary btn-sm">
                  <RotateCcw size={14} />
                  <span>Change</span>
                </button>
                <button
                  type="button"
                  onClick={() => onLocationTrackingChange(!locationTrackingEnabled)}
                  aria-pressed={locationTrackingEnabled}
                  className={`btn btn-sm ${locationTrackingEnabled ? 'btn-primary' : 'btn-secondary'}`}
                >
                  <MapPin size={14} />
                  <span>Location</span>
                </button>
                <button type="button" onClick={onGenerate} className="btn btn-primary btn-sm">
                  <Fingerprint size={14} />
                  <span>Generate</span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
