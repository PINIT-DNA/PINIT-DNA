/**
 * Multi-platform share deep links for an existing PinIT Smart Share URL.
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

export type EditorCloudTarget = 'canva' | 'adobe' | 'drive' | 'dropbox';

const EDITOR_CLOUD_GUIDE: Record<EditorCloudTarget, string> = {
  canva: 'Upload the downloaded protected file in Canva, edit, then re-protect in Pinit HUB.',
  adobe: 'Upload the downloaded protected file in Adobe Express, edit, then re-protect in Pinit HUB.',
  drive: 'Upload the downloaded protected file to Google Drive from the upload dialog.',
  dropbox: 'Upload the downloaded protected file to Dropbox from the upload dialog.',
};

export function editorCloudGuide(target: EditorCloudTarget): string {
  return EDITOR_CLOUD_GUIDE[target];
}

/** Open editor / cloud upload helpers (download-first workflow; no OAuth required). */
export function openCanvaHome(): void {
  window.open('https://www.canva.com/', '_blank', 'noopener,noreferrer');
}

export function openAdobeExpress(): void {
  window.open('https://express.adobe.com/', '_blank', 'noopener,noreferrer');
}

export function openGoogleDriveUpload(): void {
  window.open('https://drive.google.com/drive/u/0/my-drive', '_blank', 'noopener,noreferrer');
}

export function openDropboxUpload(): void {
  window.open('https://www.dropbox.com/home', '_blank', 'noopener,noreferrer');
}

export function openEditorOrCloud(
  target: EditorCloudTarget,
  onGuide?: (message: string) => void,
): void {
  onGuide?.(editorCloudGuide(target));
  switch (target) {
    case 'canva':
      openCanvaHome();
      break;
    case 'adobe':
      openAdobeExpress();
      break;
    case 'drive':
      openGoogleDriveUpload();
      break;
    case 'dropbox':
      openDropboxUpload();
      break;
  }
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
