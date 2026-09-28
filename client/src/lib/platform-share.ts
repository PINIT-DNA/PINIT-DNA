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

function isShareAbort(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const msg = err instanceof Error ? err.message : String(err);
  return name === 'AbortError' || /canceled|cancelled/i.test(msg);
}

async function tryNativeShare(data: ShareData): Promise<'shared' | 'aborted' | 'skip'> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return 'skip';
  if (typeof navigator.canShare === 'function') {
    try {
      if (!navigator.canShare(data)) return 'skip';
    } catch {
      return 'skip';
    }
  }
  try {
    await navigator.share(data);
    return 'shared';
  } catch (err) {
    if (isShareAbort(err)) return 'aborted';
    return 'skip';
  }
}

/**
 * Open the device share sheet (same picker as Photos / Gallery).
 * Phones list every installed app that accepts the file. Laptops list fewer.
 * File payloads are tried first so image/video apps appear, not only browsers.
 */
export async function shareWithOsSheet(params: {
  title: string;
  shareUrl: string;
  file?: File;
}): Promise<'shared' | 'aborted' | 'unavailable'> {
  const { title, shareUrl, file } = params;
  const text = `${title} — protected with Pinit HUB\n${shareUrl}`;

  if (file) {
    const fileAttempts: ShareData[] = [
      { title, text, files: [file] },
      { title, files: [file] },
    ];
    for (const payload of fileAttempts) {
      const result = await tryNativeShare(payload);
      if (result === 'shared' || result === 'aborted') return result;
    }
  }

  const linkAttempts: ShareData[] = [
    { title, text, url: shareUrl },
    { title, text },
  ];
  for (const payload of linkAttempts) {
    const result = await tryNativeShare(payload);
    if (result === 'shared' || result === 'aborted') return result;
  }

  return 'unavailable';
}

/** Mobile / desktop OS share sheet when available. */
export async function shareViaOs(shareUrl: string, filename = 'Protected file', file?: File): Promise<boolean> {
  const result = await shareWithOsSheet({ title: filename, shareUrl, file });
  return result === 'shared';
}
