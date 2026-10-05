import { File, Paths } from 'expo-file-system';

const PREVIEW_STEM = 'pinit-open-preview';

function extensionForMime(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('webm')) return '.webm';
  if (mime.startsWith('audio/mpeg')) return '.mp3';
  if (mime.startsWith('audio/')) return '.m4a';
  if (mime.includes('pdf')) return '.pdf';
  if (mime.includes('html')) return '.html';
  if (mime.startsWith('text/')) return '.txt';
  return '.bin';
}

/** Cache only. The system may delete this, and the next open replaces it. */
export function writePreviewFile(bytes: Uint8Array, mimeType: string): string {
  const next = new File(Paths.cache, `${PREVIEW_STEM}${extensionForMime(mimeType)}`);
  for (const ext of ['.jpg', '.png', '.webp', '.gif', '.mp4', '.mov', '.webm', '.mp3', '.m4a', '.pdf', '.html', '.txt', '.bin']) {
    const old = new File(Paths.cache, `${PREVIEW_STEM}${ext}`);
    if (old.exists) old.delete();
  }
  next.create();
  next.write(bytes);
  return next.uri;
}

export function writeCarrierFile(filename: string, body: string): string {
  const safe = filename.replace(/[^\w.\- ]+/g, '') || 'share.pinit';
  const file = new File(Paths.cache, safe);
  if (file.exists) file.delete();
  file.create();
  file.write(body);
  return file.uri;
}
