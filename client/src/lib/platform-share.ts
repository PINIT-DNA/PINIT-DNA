/**
 * Multi-platform share deep links for an existing Pinit Smart Share URL.
 * Reuses one ShareLink — does not mint per-platform tokens.
 */

export type PlatformShareTarget =
  | 'whatsapp'
  | 'email'
  | 'telegram'
  | 'twitter'
  | 'linkedin'
  | 'copy';

export interface PlatformShareOption {
  id: PlatformShareTarget;
  label: string;
  href?: string;
}

export function buildPlatformShareOptions(
  shareUrl: string,
  filename = 'Protected file',
): PlatformShareOption[] {
  const text = `${filename} — protected with Pinit HUB\n${shareUrl}`;
  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedSubject = encodeURIComponent(`${filename} via Pinit HUB`);

  return [
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      href: `https://wa.me/?text=${encodedText}`,
    },
    {
      id: 'telegram',
      label: 'Telegram',
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(filename)}`,
    },
    {
      id: 'email',
      label: 'Email',
      href: `mailto:?subject=${encodedSubject}&body=${encodedText}`,
    },
    {
      id: 'twitter',
      label: 'X',
      href: `https://twitter.com/intent/tweet?text=${encodedText}`,
    },
    {
      id: 'linkedin',
      label: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    },
    { id: 'copy', label: 'Copy link' },
  ];
}

/** Mobile / desktop OS share sheet when available. */
export async function shareViaOs(shareUrl: string, filename = 'Protected file'): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    await navigator.share({
      title: filename,
      text: `${filename} — protected with Pinit HUB`,
      url: shareUrl,
    });
    return true;
  } catch {
    return false;
  }
}
