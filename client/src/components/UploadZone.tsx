import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { Upload, ScanLine, Video, Mic, FileUp, Pencil, Check, X } from 'lucide-react';
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
}

const CAPTURE_MODES: { id: CaptureMode; label: string; icon: typeof Upload }[] = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'scan', label: 'Scan', icon: ScanLine },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'audio', label: 'Audio', icon: Mic },
];

const MAX_BYTES = 500 * 1024 * 1024;

function splitName(filename: string): { base: string; ext: string } {
  const i = filename.lastIndexOf('.');
  if (i <= 0) return { base: filename, ext: '' };
  return { base: filename.slice(0, i), ext: filename.slice(i) };
}

function sanitizeBaseName(raw: string): string {
  return raw
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function renameFile(file: File, nextBase: string): File | null {
  const { ext } = splitName(file.name);
  const base = sanitizeBaseName(nextBase);
  if (!base) return null;
  const name = `${base}${ext}`;
  if (name === file.name) return file;
  return new File([file], name, { type: file.type, lastModified: file.lastModified });
}

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
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4 bg-bg-surface rounded-xl">
        <span className="text-4xl">{icon}</span>
        <audio src={objectUrl} controls className="w-full max-w-[200px]" />
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

export function UploadZone({ onFileSelected, onGenerate, selectedFile }: Props) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('upload');
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const handleFileReady = useCallback(
    (file: File) => {
      onFileSelected(file);
      setCaptureMode('upload');
      setRenaming(false);
      setRenameError(null);
    },
    [onFileSelected],
  );

  const startRename = useCallback(() => {
    if (!selectedFile) return;
    setRenameDraft(splitName(selectedFile.name).base);
    setRenameError(null);
    setRenaming(true);
  }, [selectedFile]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
    setRenameError(null);
  }, []);

  const applyRename = useCallback(() => {
    if (!selectedFile) return;
    const next = renameFile(selectedFile, renameDraft);
    if (!next) {
      setRenameError('Enter a valid file name');
      return;
    }
    onFileSelected(next);
    setRenaming(false);
    setRenameError(null);
  }, [selectedFile, renameDraft, onFileSelected]);

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
  const selectedExt = selectedFile ? splitName(selectedFile.name).ext : '';

  return (
    <div className="max-w-3xl mx-auto w-full">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <div className="text-6xl mb-4 dna-float">🧬</div>
        <h2 className="text-3xl font-bold text-white">Protect file</h2>
      </motion.div>

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
              className={`rounded-xl border p-3 text-left transition-all ${
                captureMode === id
                  ? 'bg-dna-500/12 border-dna-500/40 shadow-sm'
                  : 'bg-bg-card border-bg-border hover:border-dna-500/25'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon size={15} className={captureMode === id ? 'text-dna-500' : 'text-gray-400'} />
                <span className={`text-sm font-semibold ${captureMode === id ? 'text-dna-500' : 'text-white'}`}>
                  {label}
                </span>
              </div>
            </button>
          ))}
        </motion.div>
      )}

      {!selectedFile && captureMode === 'scan' && (
        <DocumentScanner
          subtitle=""
          onScanComplete={handleFileReady}
          onCancel={() => setCaptureMode('upload')}
        />
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
                  <p className="text-gray-500 text-sm mb-4">or click here to browse</p>
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
          className="rounded-2xl border-2 border-dna-500/30 bg-dna-500/5 overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row items-stretch gap-0">
            <div className="sm:w-48 h-48 sm:h-auto shrink-0 p-4">
              <div className="w-full h-full min-h-[160px] rounded-xl border border-bg-border overflow-hidden shadow-lg">
                <FilePreview file={selectedFile} />
              </div>
            </div>
            <div className="flex-1 p-6 flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-dna-400 font-semibold text-sm">Ready to Generate</p>
                <span className="mono text-xs bg-dna-500/20 text-dna-400 px-2 py-0.5 rounded">{fileLabel}</span>
              </div>

              {renaming ? (
                <div className="mt-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={renameDraft}
                      onChange={(e) => {
                        setRenameDraft(e.target.value);
                        setRenameError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyRename();
                        }
                        if (e.key === 'Escape') cancelRename();
                      }}
                      autoFocus
                      className="input flex-1 min-w-0 text-sm font-medium"
                      placeholder="File name"
                      aria-label="Rename file"
                    />
                    {selectedExt && (
                      <span className="mono text-xs text-gray-500 shrink-0">{selectedExt}</span>
                    )}
                    <button
                      type="button"
                      onClick={applyRename}
                      className="btn-primary btn-sm px-2.5"
                      title="Save name"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelRename}
                      className="btn-secondary btn-sm px-2.5"
                      title="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {renameError && <p className="text-xs text-danger">{renameError}</p>}
                  <p className="text-2xs text-gray-500">Extension stays the same ({selectedExt || 'none'}).</p>
                </div>
              ) : (
                <div className="flex items-start gap-2 mt-0.5">
                  <p className="text-white font-medium text-lg truncate min-w-0 flex-1">{selectedFile.name}</p>
                  <button
                    type="button"
                    onClick={startRename}
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-dna-500 hover:text-dna-600 mt-1"
                  >
                    <Pencil size={12} />
                    Rename
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-4 mt-2">
                <span className="mono text-xs text-gray-400">{formatBytes(selectedFile.size)}</span>
                <span className="mono text-xs text-gray-400">{selectedFile.type || 'unknown'}</span>
              </div>
              <p className="text-gray-500 text-xs mt-3">
                Not protected yet — rename if needed, then click below to create identity and store this file.
              </p>
              <button
                type="button"
                onClick={() => {
                  setRenaming(false);
                  onFileSelected(null);
                }}
                className="mt-4 text-xs text-gray-500 hover:text-dna-400 transition-colors text-left w-fit"
              >
                ← Change file
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
          <button type="button" onClick={onGenerate} className="btn-primary text-base px-10 py-4">
            <span>Protect This File</span>
            <span className="text-lg">→</span>
          </button>
        </motion.div>
      )}
    </div>
  );
}
