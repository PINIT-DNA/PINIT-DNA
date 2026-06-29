export const FILE_TYPES = [
  { label: 'IMAGE', exts: ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.gif', '.bmp'], icon: '🖼️', color: 'text-pink-400', mime: 'image/*' },
  { label: 'PDF', exts: ['.pdf'], icon: '📄', color: 'text-red-400', mime: 'application/pdf' },
  { label: 'DOCX', exts: ['.docx'], icon: '📝', color: 'text-blue-400', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { label: 'PPTX', exts: ['.pptx'], icon: '📊', color: 'text-orange-400', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { label: 'TXT', exts: ['.txt', '.md', '.log'], icon: '📃', color: 'text-gray-300', mime: 'text/plain' },
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
