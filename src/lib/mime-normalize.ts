/**
 * Normalize browser-declared MIME types (e.g. video/webm;codecs=vp9,opus).
 */
export function normalizeMimeType(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return base;
}

/**
 * Match declared MIME against allow-list.
 * Also accepts any image/* or video/* when that family exists in allowed,
 * and optional extension fallback via `originalName`.
 */
export function mimeMatchesAllowed(
  declared: string,
  allowed: string[],
  originalName?: string,
): boolean {
  const base = normalizeMimeType(declared);
  if (!base && !originalName) return false;

  if (base && (allowed.includes(base) || allowed.includes(declared))) return true;

  // Browsers invent MIME subtypes; accept whole image/video families when configured
  if (base.startsWith('image/') && allowed.some((a) => a.startsWith('image/') || a === 'image/*')) {
    return true;
  }
  if (base.startsWith('video/') && allowed.some((a) => a.startsWith('video/') || a === 'video/*')) {
    return true;
  }

  if (originalName) {
    const ext = originalName.includes('.')
      ? `.${originalName.split('.').pop()!.toLowerCase()}`
      : '';
    if (ext && isImageOrVideoExtension(ext)) return true;
  }

  // Empty/unknown MIME with media extension (common for .mkv / .heic on Windows)
  if ((!base || base === 'application/octet-stream') && originalName) {
    const ext = `.${originalName.split('.').pop()?.toLowerCase() || ''}`;
    if (isImageOrVideoExtension(ext)) return true;
  }

  return false;
}

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.webp', '.tiff', '.tif', '.gif', '.bmp',
  '.heic', '.heif', '.avif', '.svg', '.ico', '.jxl', '.apng',
]);

const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.mov', '.qt', '.avi', '.mkv', '.webm', '.mpeg', '.mpg', '.mpe',
  '.3gp', '.3g2', '.ogv', '.ogg', '.flv', '.wmv', '.ts', '.mts', '.m2ts',
]);

export function isImageOrVideoExtension(ext: string): boolean {
  const e = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return IMAGE_EXTS.has(e) || VIDEO_EXTS.has(e);
}

export function isImageMimeOrExt(mime: string, fileName?: string): boolean {
  const base = normalizeMimeType(mime);
  if (base.startsWith('image/')) return true;
  if (fileName) {
    const ext = `.${fileName.split('.').pop()?.toLowerCase() || ''}`;
    return IMAGE_EXTS.has(ext);
  }
  return false;
}

export function isVideoMimeOrExt(mime: string, fileName?: string): boolean {
  const base = normalizeMimeType(mime);
  if (base.startsWith('video/')) return true;
  if (fileName) {
    const ext = `.${fileName.split('.').pop()?.toLowerCase() || ''}`;
    return VIDEO_EXTS.has(ext);
  }
  return false;
}
