import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import * as docxPreview from 'docx-preview';
import { previewVaultFile } from '../services/dashboard.api';
import { runVaultPreviewQueued, withVaultPreviewRetry } from '../lib/vault-preview-queue';
import {
  getVaultFileIcon,
  isAudioMime,
  isDocxMime,
  isHtmlMime,
  isImageMime,
  isPdfMime,
  isTextMime,
  isVideoMime,
  resolveVaultFileMime,
  vaultFileShouldLoadPreview,
} from '../lib/file-type-utils';

interface CachedPreview {
  url: string;
  effectiveMime: string;
  textSnippet?: string;
  blob: Blob;
}

const thumbCache = new Map<string, CachedPreview>();
const inflight = new Map<string, Promise<CachedPreview>>();

async function loadVaultPreview(vaultId: string, declaredMime: string, fileName: string): Promise<CachedPreview> {
  const cached = thumbCache.get(vaultId);
  if (cached) return cached;

  const pending = inflight.get(vaultId);
  if (pending) return pending;

  const promise = runVaultPreviewQueued(() =>
    withVaultPreviewRetry(() => previewVaultFile(vaultId)),
  )
    .then(async blob => {
      const effectiveMime = resolveVaultFileMime(blob.type, declaredMime, fileName);
      const typedBlob = blob.type === effectiveMime ? blob : new Blob([blob], { type: effectiveMime });
      const url = URL.createObjectURL(typedBlob);

      let textSnippet: string | undefined;
      if (isTextMime(effectiveMime, fileName) && !isHtmlMime(effectiveMime, fileName)) {
        try {
          const raw = await typedBlob.text();
          textSnippet = raw.slice(0, 600).replace(/\s+/g, ' ').trim();
        } catch {
          textSnippet = undefined;
        }
      }

      const entry: CachedPreview = { url, effectiveMime, textSnippet, blob: typedBlob };
      thumbCache.set(vaultId, entry);
      return entry;
    })
    .finally(() => {
      inflight.delete(vaultId);
    });

  inflight.set(vaultId, promise);
  return promise;
}

interface VaultFileThumbnailProps {
  vaultId: string;
  fileName: string;
  mimeType: string;
  variant?: 'compact' | 'gallery';
  className?: string;
}

export function VaultFileThumbnail({
  vaultId,
  fileName,
  mimeType,
  variant = 'compact',
  className,
}: VaultFileThumbnailProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<CachedPreview | null>(() => thumbCache.get(vaultId) ?? null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const docxRef = useRef<HTMLDivElement>(null);

  const shouldLoad = vaultFileShouldLoadPreview(mimeType, fileName);
  const icon = getVaultFileIcon(mimeType, fileName);
  const effectiveMime = preview?.effectiveMime ?? resolveVaultFileMime(undefined, mimeType, fileName);

  const frameClass = className ?? (
    variant === 'gallery'
      ? 'w-full h-full min-h-[140px]'
      : 'w-10 h-10 rounded-lg shrink-0'
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !shouldLoad || preview || failed) return;

    let cancelled = false;
    setLoading(true);

    loadVaultPreview(vaultId, mimeType, fileName)
      .then(entry => {
        if (!cancelled) setPreview(entry);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, shouldLoad, vaultId, mimeType, fileName, preview, failed]);

  useEffect(() => {
    if (!preview || !isDocxMime(preview.effectiveMime, fileName) || variant !== 'gallery' || !docxRef.current) return;
    const container = docxRef.current;
    container.innerHTML = '';
    docxPreview.renderAsync(preview.blob, container, undefined, {
      className: 'docx-vault-thumb',
      inWrapper: true,
      ignoreWidth: true,
      ignoreHeight: true,
      useBase64URL: true,
      renderHeaders: false,
      renderFooters: false,
      renderFootnotes: false,
    }).catch(() => {});
  }, [preview, fileName, variant]);

  const lockBadge = (
    <span className={`absolute z-10 ${variant === 'gallery' ? 'bottom-2 right-2 w-6 h-6' : 'bottom-0.5 right-0.5 w-3.5 h-3.5'} rounded bg-black/70 flex items-center justify-center`}>
      <Lock size={variant === 'gallery' ? 11 : 8} className="text-success" />
    </span>
  );

  const fallback = (
    <div
      className={`${frameClass} bg-bg-elevated border border-bg-border flex flex-col items-center justify-center gap-1 ${variant === 'gallery' ? 'p-4' : ''}`}
      title={fileName}
    >
      <span className={variant === 'gallery' ? 'text-4xl' : 'text-lg'} aria-hidden>{icon}</span>
      {variant === 'gallery' && (
        <p className="text-2xs text-gray-500 text-center line-clamp-2 px-2">{fileName}</p>
      )}
    </div>
  );

  if (!shouldLoad || failed || (imgError && isImageMime(effectiveMime, fileName)) || (videoError && isVideoMime(effectiveMime, fileName))) {
    return <div ref={rootRef}>{fallback}</div>;
  }

  if (!preview) {
    return (
      <div
        ref={rootRef}
        className={`${frameClass} bg-bg-elevated border border-bg-border flex items-center justify-center overflow-hidden`}
        title={fileName}
      >
        {loading ? (
          <div className="w-full h-full animate-pulse bg-bg-border/60" />
        ) : (
          <span className={`${variant === 'gallery' ? 'text-3xl' : 'text-lg'} opacity-60`} aria-hidden>{icon}</span>
        )}
      </div>
    );
  }

  const { url, textSnippet } = preview;

  if (isImageMime(effectiveMime, fileName) && !imgError) {
    return (
      <div ref={rootRef} className={`relative ${frameClass} overflow-hidden border border-bg-border bg-black/30`} title={fileName}>
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover pinit-protected-media"
          loading="lazy"
          decoding="async"
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          onError={() => setImgError(true)}
        />
        {lockBadge}
      </div>
    );
  }

  if (isVideoMime(effectiveMime, fileName) && !videoError) {
    return (
      <div ref={rootRef} className={`relative ${frameClass} overflow-hidden border border-bg-border bg-black`} title={fileName}>
        <video
          src={`${url}#t=0.5`}
          className="w-full h-full object-cover"
          muted
          playsInline
          preload="auto"
          onError={() => setVideoError(true)}
        />
        {lockBadge}
      </div>
    );
  }

  if (isPdfMime(effectiveMime, fileName)) {
    return (
      <div ref={rootRef} className={`relative ${frameClass} overflow-hidden border border-bg-border bg-white`} title={fileName}>
        <iframe
          src={`${url}#page=1&toolbar=0&navpanes=0&view=FitH`}
          title={fileName}
          className="absolute inset-0 w-full h-full border-0 pointer-events-none bg-white"
        />
        <div className="absolute top-0 left-0 right-0 bg-red-500/90 text-white text-2xs font-bold px-2 py-0.5 z-[1]">
          PDF
        </div>
        {lockBadge}
      </div>
    );
  }

  if (isHtmlMime(effectiveMime, fileName)) {
    return (
      <div ref={rootRef} className={`relative ${frameClass} overflow-hidden border border-bg-border bg-white`} title={fileName}>
        <iframe
          src={url}
          title={fileName}
          sandbox=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 border-0 pointer-events-none bg-white origin-top-left"
          style={
            variant === 'gallery'
              ? { width: '250%', height: '250%', transform: 'scale(0.4)' }
              : { width: '400%', height: '400%', transform: 'scale(0.25)' }
          }
        />
        <div className="absolute top-0 left-0 right-0 bg-teal-600/90 text-white text-2xs font-bold px-2 py-0.5 z-[1]">
          HTML
        </div>
        {lockBadge}
      </div>
    );
  }

  if (isTextMime(effectiveMime, fileName)) {
    return (
      <div ref={rootRef} className={`relative ${frameClass} overflow-hidden border border-bg-border bg-[#0f172a]`} title={fileName}>
        <div className="absolute inset-0 p-2 overflow-hidden pt-5">
          <p className="text-[9px] leading-tight text-gray-300 font-mono whitespace-pre-wrap break-all line-clamp-[12]">
            {textSnippet || 'Loading text…'}
          </p>
        </div>
        <div className="absolute top-0 left-0 right-0 bg-gray-700/90 text-white text-2xs font-bold px-2 py-0.5 z-[1]">
          TXT
        </div>
        {lockBadge}
      </div>
    );
  }

  if (isDocxMime(effectiveMime, fileName)) {
    if (variant === 'gallery') {
      return (
        <div ref={rootRef} className={`relative ${frameClass} overflow-hidden border border-bg-border bg-white`} title={fileName}>
          <div
            ref={docxRef}
            className="absolute inset-0 overflow-hidden pointer-events-none scale-[0.35] origin-top-left w-[285%] h-[285%] text-black"
          />
          <div className="absolute top-0 left-0 right-0 bg-blue-600/90 text-white text-2xs font-bold px-2 py-0.5 z-[1]">
            DOCX
          </div>
          {lockBadge}
        </div>
      );
    }
    return (
      <div ref={rootRef} className={`relative ${frameClass} overflow-hidden border border-bg-border bg-blue-500/10 flex items-center justify-center`} title={fileName}>
        <span className="text-lg" aria-hidden>📝</span>
        {lockBadge}
      </div>
    );
  }

  if (isAudioMime(effectiveMime, fileName)) {
    return (
      <div ref={rootRef} className={`relative ${frameClass} overflow-hidden border border-bg-border bg-bg-elevated flex flex-col items-center justify-center gap-2`} title={fileName}>
        <span className={variant === 'gallery' ? 'text-4xl' : 'text-xl'} aria-hidden>🎵</span>
        {variant === 'gallery' && (
          <audio src={url} controls className="w-[90%] max-h-8" preload="metadata" />
        )}
        {lockBadge}
      </div>
    );
  }

  return <div ref={rootRef}>{fallback}</div>;
}
