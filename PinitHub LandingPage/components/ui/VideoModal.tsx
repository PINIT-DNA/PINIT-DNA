'use client';

import { X } from 'lucide-react';
import { useEffect } from 'react';

type ParsedVideo =
  | { kind: 'youtube'; id: string }
  | { kind: 'vimeo'; id: string }
  | { kind: 'file'; url: string }
  | { kind: 'embed'; url: string };

/** Recognizes YouTube, Vimeo, and ScreenPal links; video files play natively;
 *  anything else falls back to a generic iframe embed. */
function parseVideoUrl(raw: string): ParsedVideo | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'youtube.com') {
    const id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.split('/').pop();
    if (id) return { kind: 'youtube', id };
  }
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    if (id) return { kind: 'youtube', id };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).pop();
    if (id && /^\d+$/.test(id)) return { kind: 'vimeo', id };
  }
  // ScreenPal share links: /watch/ID → embed player /player/ID
  if (host === 'go.screenpal.com' || host === 'screenpal.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[0] === 'watch' || parts[0] === 'player' ? parts[1] : parts.pop();
    if (id) {
      return {
        kind: 'embed',
        url: `https://go.screenpal.com/player/${id}?width=100%&height=100%&ff=1&title=0`,
      };
    }
  }
  if (/\.(mp4|webm|ogg|mov)$/i.test(url.pathname)) {
    return { kind: 'file', url: raw };
  }
  return { kind: 'embed', url: raw };
}

export function VideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const video = parseVideoUrl(url);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Platform video"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/90 p-3 backdrop-blur-sm sm:p-8"
    >
      <div className="relative w-full max-w-4xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close video"
          className="absolute top-2 right-2 z-10 grid h-10 w-10 place-items-center rounded-full border border-line bg-ink-2/90 text-mute transition-colors hover:text-paper sm:-top-12 sm:right-0 sm:bg-ink-2/80"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative aspect-video overflow-hidden rounded-2xl border border-line bg-ink-2 shadow-[0_50px_90px_-25px_rgba(2,5,14,0.95)]">
          {video?.kind === 'youtube' && (
            <iframe
              src={`https://www.youtube.com/embed/${video.id}?autoplay=1`}
              title="Platform video"
              className="h-full w-full"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          )}
          {video?.kind === 'vimeo' && (
            <iframe
              src={`https://player.vimeo.com/video/${video.id}?autoplay=1`}
              title="Platform video"
              className="h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          )}
          {video?.kind === 'file' && <video src={video.url} controls autoPlay className="h-full w-full" />}
          {video?.kind === 'embed' && (
            <iframe
              src={video.url}
              title="Platform video"
              className="h-full w-full"
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          )}
          {!video && (
            <div className="grid h-full place-items-center p-8 text-center text-mute-2">
              This video link couldn&rsquo;t be played.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
