'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { parseVideoUrl } from '@/components/ui/VideoModal';
import { LANDING_DEMO_VIDEO_URL } from '@/lib/site';

const DemoContext = createContext<{ open: (from?: HTMLElement | null) => void }>({ open: () => {} });
export const useDemo = () => useContext(DemoContext);

/** One demo window for the whole page; any "Watch" button opens it. */
export function DemoProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement as HTMLElement | null);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    opener.current?.focus?.();
  }, []);
  return (
    <DemoContext.Provider value={{ open }}>
      {children}
      {isOpen ? <DemoModal onClose={close} /> : null}
    </DemoContext.Provider>
  );
}

export function WatchDemoButton({ label = 'Watch PINIT in action', className = 'btn btn-ghost-ink btn-demo' }: { label?: string; className?: string }) {
  const { open } = useDemo();
  return (
    <button type="button" className={className} onClick={(e) => open(e.currentTarget)} aria-haspopup="dialog">
      <span className="play" aria-hidden="true">
        <svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 1l7 4-7 4z" /></svg>
      </span>
      {label}
    </button>
  );
}

function DemoModal({ onClose }: { onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);
  const video = LANDING_DEMO_VIDEO_URL ? parseVideoUrl(LANDING_DEMO_VIDEO_URL) : null;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const items = [...boxRef.current.querySelectorAll<HTMLElement>('button, video[controls], a[href]')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="lp">
      <div
        className="modal open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-title"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="modal-box" ref={boxRef}>
          <div className="modal-head">
            <h2 id="demo-title">PINIT in action</h2>
            <button ref={closeRef} type="button" className="modal-close" onClick={onClose} aria-label="Close video">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className={`modal-frame ${failed ? 'failed' : ''}`}>
            {video?.kind === 'file' ? (
              <video src={video.url} controls autoPlay playsInline preload="metadata" aria-label="PINIT product walkthrough" onError={() => setFailed(true)} />
            ) : video?.kind === 'youtube' ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
                title="PINIT product walkthrough"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 0 }}
              />
            ) : video?.kind === 'vimeo' ? (
              <iframe
                src={`https://player.vimeo.com/video/${video.id}?autoplay=1`}
                title="PINIT product walkthrough"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 0 }}
              />
            ) : video?.kind === 'embed' ? (
              <iframe src={video.url} title="PINIT product walkthrough" allow="autoplay; fullscreen" allowFullScreen style={{ width: '100%', height: '100%', border: 0 }} />
            ) : (
              <div className="modal-soon">
                <div>
                  <span className="lp-eyebrow">Product walkthrough</span>
                  <p className="soon-title">The PINIT walkthrough is coming soon.</p>
                  <p className="soon-sub">A short film of protecting an asset, sharing it and tracking it live.</p>
                </div>
              </div>
            )}
            <div className="modal-fail"><p>The video couldn&rsquo;t be loaded. Please try again.</p></div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
