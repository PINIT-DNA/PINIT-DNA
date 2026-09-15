'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Megaphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pinithub-announcement-dismissed';

/**
 * Admin-controlled announcement, driven by SiteSettings.announcement.
 *
 * Deliberately docked to the bottom rather than stacked above the navbar: it
 * can appear and disappear from /admin without changing the height of the
 * fixed header, so no section has to know whether it is showing.
 */
export function AnnouncementBar({ text, href }: { text: string; href: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!text.trim()) return;
    // Dismissal is keyed to the message, so a new announcement shows again.
    setVisible(window.localStorage.getItem(STORAGE_KEY) !== text);
  }, [text]);

  const dismiss = () => {
    window.localStorage.setItem(STORAGE_KEY, text);
    setVisible(false);
  };

  if (!text.trim()) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          role="status"
          className="fixed inset-x-4 z-[60] mx-auto w-fit max-w-[calc(100%-2rem)] bottom-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex items-center gap-3 rounded-full border border-cyan/25 bg-ink-2/90 py-2 pr-2 pl-4 shadow-[0_24px_60px_-24px_rgba(0,0,0,1)] backdrop-blur-xl">
            <Megaphone className="h-4 w-4 shrink-0 text-cyan" strokeWidth={1.7} />
            <a
              href={href || '#demo'}
              className="group inline-flex min-w-0 items-center gap-1.5 text-[0.875rem] text-mute transition-colors hover:text-paper"
            >
              <span className="truncate">{text}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-cyan transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss announcement"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-mute-2 transition-colors hover:bg-white/8 hover:text-paper"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
