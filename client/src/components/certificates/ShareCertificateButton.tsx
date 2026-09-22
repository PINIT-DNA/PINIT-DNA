import { useEffect, useRef, useState } from 'react';
// This lucide version ships no brand marks, so each app gets a neutral icon
// rather than a glyph that reads as the wrong brand.
import { Share2, MessageCircle, Mail, Send, Briefcase, AtSign, Link2, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import type { HubCredential } from '../../services/dashboard.api';

/** The public page anyone can open to check a certificate — the same one its QR code points at. */
export function certificateVerifyUrl(certificateId: string): string {
  return `${window.location.origin}/verify-certificate?id=${encodeURIComponent(certificateId)}`;
}

/**
 * Share a certificate by its verification link.
 *
 * What gets shared is proof, not the file: the link opens the public verification
 * page, which needs no account and shows the certificate's live status — a revoked
 * certificate says so there. Sharing the protected file itself stays in the vault
 * share dialog, where expiry and location rules apply.
 *
 * The menu names the apps people actually use, because the system share sheet only
 * exists on phones and some browsers — on a desktop browser the old behaviour
 * silently degraded to "link copied", which is not what pressing Share looks like it
 * will do. The sheet is still offered first where it exists.
 */

interface ShareTarget {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Builds the app's share URL. Nothing is sent anywhere until the user picks one. */
  href: (url: string, text: string) => string;
}

const TARGETS: ShareTarget[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: <MessageCircle size={15} aria-hidden />,
    href: (url, text) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    id: 'email',
    label: 'Email',
    icon: <Mail size={15} aria-hidden />,
    href: (url, text) => `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    icon: <Send size={15} aria-hidden />,
    href: (url, text) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    icon: <Briefcase size={15} aria-hidden />,
    href: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'x',
    label: 'X',
    icon: <AtSign size={15} aria-hidden />,
    href: (url, text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
];

export function ShareCertificateButton({
  item,
  className,
  label = 'Share certificate',
  iconSize = 14,
}: {
  item: HubCredential;
  className?: string;
  label?: string;
  iconSize?: number;
}) {
  const [open, setOpen] = useState(false);
  // The button often sits at the bottom of a modal whose panel hides overflow, so a
  // menu opening downward would be cut in half. Flip it above when space is short.
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const certId = item.source?.id;

  // Close on an outside click or Escape, like every other menu in the app.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!certId) return null;

  const url = certificateVerifyUrl(certId);
  const text = `Verify the Pinit certificate for ${item.title}`;
  const shareData: ShareData = { title: `${item.title} — Pinit certificate`, text, url };

  const hasSystemSheet =
    typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && (typeof navigator.canShare !== 'function' || navigator.canShare(shareData));

  const openTarget = (target: ShareTarget) => {
    setOpen(false);
    const href = target.href(url, text);
    // Email opens the mail client in place; the rest are web pages.
    if (target.id === 'email') window.location.href = href;
    else window.open(href, '_blank', 'noopener,noreferrer');
  };

  const copyLink = async () => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Verification link copied — anyone can open it without an account');
    } catch {
      toast.error('Could not copy the verification link');
    }
  };

  const systemShare = async () => {
    setOpen(false);
    try {
      await navigator.share(shareData);
    } catch (err) {
      // Closing the sheet is a choice, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      void copyLink();
    }
  };

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        className={className}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          // ~7 rows plus padding; enough to decide which way it fits.
          if (rect) setDropUp(window.innerHeight - rect.bottom < 280);
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Share2 size={iconSize} aria-hidden />
        {label}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute right-0 z-50 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900 ${
            dropUp ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {TARGETS.map((t) => (
            <button
              key={t.id}
              role="menuitem"
              type="button"
              onClick={() => openTarget(t)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {t.icon}
              {t.label}
            </button>
          ))}

          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

          <button
            role="menuitem"
            type="button"
            onClick={() => void copyLink()}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Link2 size={15} aria-hidden />
            Copy link
          </button>

          {hasSystemSheet && (
            <button
              role="menuitem"
              type="button"
              onClick={() => void systemShare()}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <Smartphone size={15} aria-hidden />
              More apps…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
