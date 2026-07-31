import { useEffect } from 'react';
import { Mic, Video, Square, RotateCcw, Check, AlertCircle } from 'lucide-react';
import { useMediaRecorder, type RecorderMode } from '../hooks/useMediaRecorder';
import { formatDuration, formatBytes } from '../lib/file-type-utils';

interface Props {
  mode: RecorderMode;
  onComplete: (file: File) => void;
  onCancel?: () => void;
  autoStart?: boolean;
}

export function MediaRecorderPanel({ mode, onComplete, onCancel, autoStart = true }: Props) {
  const {
    status,
    error,
    elapsedSec,
    limitSec,
    previewUrl,
    recordedFile,
    audioLevel,
    videoRef,
    startPreview,
    startRecording,
    stopRecording,
    reset,
  } = useMediaRecorder({ mode });

  useEffect(() => {
    if (autoStart && status === 'idle') startPreview();
  }, [autoStart, startPreview, status]);

  const isVideo = mode === 'video';
  const title = isVideo ? 'Record Video' : 'Record Audio';
  const Icon = isVideo ? Video : Mic;

  return (
    <div className="rounded-2xl border border-bg-border bg-bg-card overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border bg-bg-elevated/60">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-dna-500/10 flex items-center justify-center">
            <Icon size={16} className="text-dna-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-2xs text-gray-500">
              {isVideo ? 'Camera + microphone · WebM/MP4' : 'Microphone · WebM/OGG'}
            </p>
          </div>
        </div>
        <span className="mono text-xs text-gray-400">
          Max {formatDuration(limitSec)}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Live or playback viewport */}
        <div className="relative rounded-xl overflow-hidden border-2 border-dna-500/20 bg-black/90 aspect-video max-h-[320px] flex items-center justify-center">
          {isVideo ? (
            <>
              <video
                ref={videoRef}
                className={`w-full h-full object-cover ${status === 'stopped' && previewUrl ? 'hidden' : ''}`}
                autoPlay
                playsInline
                muted
              />
              {status === 'stopped' && previewUrl && (
                <video src={previewUrl} className="w-full h-full object-cover" controls playsInline />
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-6">
              {status === 'stopped' && previewUrl ? (
                <audio src={previewUrl} controls className="w-full max-w-md" />
              ) : (
                <>
                  <div className="w-20 h-20 rounded-full bg-dna-500/15 flex items-center justify-center">
                    <Mic size={32} className="text-dna-400" />
                  </div>
                  <div className="w-full max-w-xs h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-dna-400 transition-all duration-75 rounded-full"
                      style={{ width: `${Math.max(4, audioLevel)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400">
                    {status === 'recording' ? 'Recording…' : 'Audio level monitor'}
                  </p>
                </>
              )}
            </div>
          )}

          {status === 'recording' && (
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-600/90 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              REC {formatDuration(elapsedSec)}
            </div>
          )}

          {(status === 'requesting') && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <p className="text-sm text-white font-medium">Requesting permissions…</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-2">
          {status === 'idle' || status === 'error' ? (
            <button type="button" onClick={startPreview} className="btn btn-primary flex-1 py-3 rounded-xl text-sm font-semibold">
              <Icon size={16} /> Enable {isVideo ? 'Camera' : 'Microphone'}
            </button>
          ) : null}

          {status === 'ready' && (
            <button
              type="button"
              onClick={startRecording}
              className="btn btn-primary flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            >
              <span className="w-3 h-3 rounded-full bg-red-500" /> Start Recording
            </button>
          )}

          {status === 'recording' && (
            <button
              type="button"
              onClick={stopRecording}
              className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              <Square size={16} fill="currentColor" /> Stop
            </button>
          )}

          {status === 'stopped' && recordedFile && (
            <>
              <button
                type="button"
                onClick={() => onComplete(recordedFile)}
                className="btn btn-primary flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Check size={16} /> Use Recording ({formatBytes(recordedFile.size)})
              </button>
              <button
                type="button"
                onClick={reset}
                className="bg-bg-elevated border border-bg-border text-gray-400 hover:text-white px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2"
              >
                <RotateCcw size={16} /> Retake
              </button>
            </>
          )}

          {(status === 'ready' || status === 'recording') && (
            <button
              type="button"
              onClick={() => { reset(); onCancel?.(); }}
              className="bg-bg-elevated border border-bg-border text-gray-400 hover:text-white px-4 py-3 rounded-xl text-sm font-semibold"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
