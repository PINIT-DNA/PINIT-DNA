import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Pencil, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSubscription } from '../hooks/useSubscription';
import { ProtectCaptureStudio } from './ProtectCaptureStudio';
import {
  formatBytes,
  getFileIcon,
  getFileTypeLabel,
  isAudioFile,
  isImageFile,
  isPdfFile,
  isVideoFile,
} from '../lib/file-type-utils';

interface Props {
  onFileSelected: (file: File | null) => void;
  onGenerate: () => void;
  selectedFile: File | null;
}

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
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const handleFileReady = useCallback(
    (file: File) => {
      onFileSelected(file);
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

  const { subscription } = useSubscription();
  const storageLimit = subscription?.enforcementEnabled ? subscription.storageLimitBytes : null;
  const storageRemaining =
    storageLimit == null ? null : Math.max(0, storageLimit - (subscription?.storageUsedBytes ?? 0));
  const exceedsStorage = Boolean(selectedFile && storageRemaining != null && selectedFile.size > storageRemaining);

  const fileLabel = selectedFile ? getFileTypeLabel(selectedFile) : '';
  const selectedExt = selectedFile ? splitName(selectedFile.name).ext : '';

  return (
    <div className="max-w-3xl mx-auto w-full">
      {!selectedFile && (
        <>
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6">
            <h2 className="text-3xl font-bold text-white leading-tight">
              Capture what matters.
              <br />
              Keep it yours.
            </h2>
            <p className="text-sm text-gray-500 mt-2 max-w-lg mx-auto">
              Take a photo or add a file. We’ll protect it, preserve its identity, and keep it safe.
            </p>
          </motion.div>
          <ProtectCaptureStudio onFileReady={handleFileReady} />
          {storageRemaining != null && (
            <p className="mt-4 text-center text-xs text-gray-500">
              {formatBytes(storageRemaining)} of storage left
            </p>
          )}
        </>
      )}

      {selectedFile && (
        <>
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6">
            <h2 className="text-3xl font-bold text-white">Looks good?</h2>
            <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
              Change the name if you like, then protect it. You can share it safely after that.
            </p>
          </motion.div>
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
                  <p className="text-dna-400 font-semibold text-sm">Your file</p>
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
                      {selectedExt && <span className="mono text-xs text-gray-500 shrink-0">{selectedExt}</span>}
                      <button type="button" onClick={applyRename} className="btn-primary btn-sm px-2.5" title="Save name">
                        <Check size={14} />
                      </button>
                      <button type="button" onClick={cancelRename} className="btn-secondary btn-sm px-2.5" title="Cancel">
                        <X size={14} />
                      </button>
                    </div>
                    {renameError && <p className="text-xs text-danger">{renameError}</p>}
                    <p className="text-2xs text-gray-500">The file type stays the same.</p>
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
                  {storageRemaining != null && (
                    <span className="mono text-xs text-gray-400">
                      {formatBytes(storageRemaining)} of storage left
                    </span>
                  )}
                </div>
                <p className="text-gray-500 text-xs mt-3">
                  This isn’t saved yet. Protect it next so it lives in your vault.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(false);
                    onFileSelected(null);
                  }}
                  className="mt-4 text-xs text-gray-500 hover:text-dna-400 transition-colors text-left w-fit"
                >
                  ← Take another
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}

      {selectedFile && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 flex justify-center">
          {exceedsStorage ? (
            <div className="max-w-lg w-full rounded-xl border border-danger/30 bg-danger/5 p-4 text-center">
              <p className="text-sm text-danger font-medium">
                This file is larger than the storage you have left.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                The file is {formatBytes(selectedFile.size)}. You have {formatBytes(storageRemaining ?? 0)} left.
              </p>
              <Link to="/upgrade?from=storage&return=/generate" className="btn-primary btn-sm mt-3 inline-flex">
                Upgrade storage
              </Link>
            </div>
          ) : (
            <button type="button" onClick={onGenerate} className="btn-primary text-base px-10 py-4">
              <span>Protect this file</span>
              <span className="text-lg">→</span>
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}
