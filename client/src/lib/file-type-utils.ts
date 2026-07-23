export const FILE_TYPES = [
  { label: 'IMAGE', exts: ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.gif', '.bmp'], icon: '🖼️', color: 'text-pink-400', mime: 'image/*' },
  { label: 'PDF', exts: ['.pdf'], icon: '📄', color: 'text-red-400', mime: 'application/pdf' },
  { label: 'DOCX', exts: ['.docx'], icon: '📝', color: 'text-blue-400', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { label: 'PPTX', exts: ['.pptx'], icon: '📊', color: 'text-orange-400', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { label: 'TXT', exts: ['.txt', '.md', '.log'], icon: '📃', color: 'text-gray-300', mime: 'text/plain' },
  { label: 'HTML', exts: ['.html', '.htm', '.xhtml'], icon: '🌐', color: 'text-teal-400', mime: 'text/html' },
  { label: 'CSV', exts: ['.csv'], icon: '📋', color: 'text-green-400', mime: 'text/csv' },
  { label: 'JSON', exts: ['.json'], icon: '🗃️', color: 'text-yellow-400', mime: 'application/json' },
  { label: 'ZIP', exts: ['.zip'], icon: '🗜️', color: 'text-purple-400', mime: 'application/zip' },
  { label: 'VIDEO', exts: ['.mp4', '.mov', '.avi', '.mkv', '.webm'], icon: '🎬', color: 'text-cyan-400', mime: 'video/*' },
  { label: 'AUDIO', exts: ['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.webm'], icon: '🎵', color: 'text-indigo-400', mime: 'audio/*' },
] ;

export const ACCEPT_MAP = FILE_TYPES.reduce<Record<string, string[]>>((acc, ft) => {
  acc[ft.mime] = [...ft.exts];
  return acc;
}, {});

export function getFileIcon(file: File): string {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const mime = file.type.toLowerCase();
  for (const ft of FILE_TYPES) {
    if (ft.exts.includes(ext) || mime.startsWith(ft.mime.replace('*', ''))) return ft.icon;
  }
  return '📁';
}

export function getFileTypeLabel(file: File): string {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const mime = file.type.toLowerCase();
  for (const ft of FILE_TYPES) {
    if (ft.exts.includes(ext) || mime.startsWith(ft.mime.replace('*', ''))) return ft.label;
  }
  return 'FILE';
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/');
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function fileExt(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? `.${parts.pop()!.toLowerCase()}` : '';
}

/** Infer MIME when DB value or blob type is missing / octet-stream. */
export function resolveVaultFileMime(
  blobType: string | undefined,
  declaredMime?: string | null,
  fileName?: string | null,
): string {
  const blob = (blobType ?? '').toLowerCase();
  const declared = (declaredMime ?? '').toLowerCase();
  const name = fileName ?? '';
  const ext = fileExt(name);

  if (blob && blob !== 'application/octet-stream') return blob;
  if (declared && declared !== 'application/octet-stream') return declared;

  if (/whatsapp\s+image/i.test(name)) return 'image/jpeg';
  if (/whatsapp\s+video/i.test(name)) return 'video/mp4';

  const extMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.bmp': 'image/bmp', '.heic': 'image/heic', '.heif': 'image/heif',
    '.tiff': 'image/tiff', '.tif': 'image/tiff', '.jfif': 'image/jpeg',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.aac': 'audio/aac', '.m4a': 'audio/mp4',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.md': 'text/markdown', '.log': 'text/plain', '.csv': 'text/csv',
    '.json': 'application/json',
    '.html': 'text/html', '.htm': 'text/html', '.xhtml': 'application/xhtml+xml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  if (extMap[ext]) return extMap[ext];

  return declared || blob || 'application/octet-stream';
}

/** MIME / filename helpers for vault rows (no File object). */
export function isImageMime(mime?: string | null, fileName?: string | null): boolean {
  const resolved = resolveVaultFileMime(undefined, mime, fileName);
  if (resolved.startsWith('image/')) return true;
  const ext = fileExt(fileName ?? '');
  return ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.gif', '.bmp', '.heic', '.heif', '.jfif'].includes(ext)
    || /whatsapp\s+image/i.test(fileName ?? '');
}

export function isVideoMime(mime?: string | null, fileName?: string | null): boolean {
  const resolved = resolveVaultFileMime(undefined, mime, fileName);
  if (resolved.startsWith('video/')) return true;
  const ext = fileExt(fileName ?? '');
  return ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.mpeg', '.mpg'].includes(ext)
    || /whatsapp\s+video/i.test(fileName ?? '');
}

export function isAudioMime(mime?: string | null, fileName?: string | null): boolean {
  const resolved = resolveVaultFileMime(undefined, mime, fileName);
  if (resolved.startsWith('audio/')) return true;
  const ext = fileExt(fileName ?? '');
  return ['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a'].includes(ext);
}

export function isPdfMime(mime?: string | null, fileName?: string | null): boolean {
  const resolved = resolveVaultFileMime(undefined, mime, fileName);
  return resolved === 'application/pdf' || fileExt(fileName ?? '') === '.pdf';
}

export function isTextMime(mime?: string | null, fileName?: string | null): boolean {
  const resolved = resolveVaultFileMime(undefined, mime, fileName);
  if (resolved.startsWith('text/') || resolved === 'application/json' || resolved === 'application/xhtml+xml') return true;
  const ext = fileExt(fileName ?? '');
  return ['.txt', '.md', '.log', '.csv', '.json', '.html', '.htm', '.xhtml'].includes(ext);
}

export function isDocxMime(mime?: string | null, fileName?: string | null): boolean {
  const resolved = resolveVaultFileMime(undefined, mime, fileName);
  return resolved === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || fileExt(fileName ?? '') === '.docx';
}

export function getVaultFileTypeLabel(mime?: string | null, fileName?: string | null): string {
  const ext = fileExt(fileName ?? '');
  const mt = resolveVaultFileMime(undefined, mime, fileName).toLowerCase();
  for (const ft of FILE_TYPES) {
    if (ft.exts.includes(ext) || mt.startsWith(ft.mime.replace('*', ''))) return ft.label;
  }
  return 'FILE';
}

/** Human-readable type for vault cards (Photo, Video, PDF, …). */
export function getVaultFileTypeDisplay(mime?: string | null, fileName?: string | null): string {
  const label = getVaultFileTypeLabel(mime, fileName);
  const display: Record<string, string> = {
    IMAGE: 'Photo',
    VIDEO: 'Video',
    PDF: 'PDF',
    AUDIO: 'Audio',
    DOCX: 'Document',
    PPTX: 'Presentation',
    TXT: 'Text',
    CSV: 'Spreadsheet',
    JSON: 'JSON',
    ZIP: 'Archive',
    FILE: 'File',
  };
  return display[label] ?? label;
}

export function getVaultFileIcon(mime?: string | null, fileName?: string | null): string {
  const ext = fileExt(fileName ?? '');
  const mt = (mime ?? '').toLowerCase();
  for (const ft of FILE_TYPES) {
    if (ft.exts.includes(ext) || mt.startsWith(ft.mime.replace('*', ''))) return ft.icon;
  }
  return '📁';
}

/** File types that load a blob preview from vault. */
export function vaultFileShouldLoadPreview(mime?: string | null, fileName?: string | null): boolean {
  return isImageMime(mime, fileName)
    || isVideoMime(mime, fileName)
    || isPdfMime(mime, fileName)
    || isTextMime(mime, fileName)
    || isAudioMime(mime, fileName)
    || isDocxMime(mime, fileName);
}

/** @deprecated use vaultFileShouldLoadPreview */
export function vaultFileSupportsVisualPreview(mime?: string | null, fileName?: string | null): boolean {
  return vaultFileShouldLoadPreview(mime, fileName);
}

export function formatBytes(b: number): string {
  if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
