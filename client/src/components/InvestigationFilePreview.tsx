import { useEffect, useState } from 'react';
import {
  getFileIcon,
  getFileTypeLabel,
  isAudioFile,
  isImageFile,
  isPdfFile,
  isVideoFile,
} from '../lib/file-type-utils';

function isVideoLike(file: File): boolean {
  return isVideoFile(file) || /\.(mp4|mov|avi|mkv|webm|m4v|mpeg|mpg)$/i.test(file.name);
}

function isAudioLike(file: File): boolean {
  return isAudioFile(file) || /\.(mp3|wav|flac|ogg|aac|m4a)$/i.test(file.name);
}

function isImageLike(file: File): boolean {
  return isImageFile(file) || /\.(jpe?g|png|gif|webp|bmp|heic|tiff?)$/i.test(file.name);
}

interface InvestigationFilePreviewProps {
  file: File;
  className?: string;
}

/** Renders image, video, audio, PDF, or file-type placeholder for investigation UI */
export function InvestigationFilePreview({ file, className }: InvestigationFilePreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!objectUrl) {
    return (
      <div className={className ?? 'w-full h-full min-h-[140px] bg-black/30 animate-pulse rounded-xl'} />
    );
  }

  if (isImageLike(file)) {
    return (
      <img
        src={objectUrl}
        alt={file.name}
        className={className ?? 'w-full h-full object-contain'}
      />
    );
  }

  if (isVideoLike(file)) {
    return (
      <video
        src={`${objectUrl}#t=0.1`}
        className={className ?? 'w-full h-full object-contain bg-black'}
        muted
        playsInline
        preload="metadata"
        controls
      />
    );
  }

  if (isAudioLike(file)) {
    return (
      <div className={className ?? 'w-full h-full flex flex-col items-center justify-center gap-3 p-4 bg-bg-elevated'}>
        <span className="text-4xl" aria-hidden>{getFileIcon(file)}</span>
        <audio src={objectUrl} controls className="w-full max-w-[220px]" preload="metadata" />
        <p className="text-2xs text-gray-500 truncate max-w-full px-2">{file.name}</p>
      </div>
    );
  }

  if (isPdfFile(file)) {
    return (
      <iframe
        src={objectUrl}
        title={file.name}
        className={className ?? 'w-full h-full min-h-[180px] bg-white rounded-lg'}
      />
    );
  }

  return (
    <div className={className ?? 'w-full h-full flex flex-col items-center justify-center gap-2 p-6 bg-bg-elevated'}>
      <span className="text-5xl" aria-hidden>{getFileIcon(file)}</span>
      <p className="text-sm font-semibold text-white">{getFileTypeLabel(file)}</p>
      <p className="text-2xs text-gray-500 text-center break-all px-2">{file.name}</p>
    </div>
  );
}
