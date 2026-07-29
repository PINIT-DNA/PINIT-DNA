/**
 * Asset lifecycle — strict transitions (additive; parallel to ProtectedPost lifecycle).
 */

export const ASSET_STATUS = {
  DRAFT: 'DRAFT',
  PROTECTED: 'PROTECTED',
  MONITORING: 'MONITORING',
  DISCOVERY: 'DISCOVERY',
  INVESTIGATING: 'INVESTIGATING',
  RESOLVED: 'RESOLVED',
  ARCHIVED: 'ARCHIVED',
  FAILED: 'FAILED',
} as const;

export type AssetLifecycleStatus = (typeof ASSET_STATUS)[keyof typeof ASSET_STATUS];

const TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['PROTECTED', 'MONITORING', 'FAILED', 'ARCHIVED'],
  PROTECTED: ['MONITORING', 'DISCOVERY', 'INVESTIGATING', 'RESOLVED', 'ARCHIVED'],
  MONITORING: ['DISCOVERY', 'INVESTIGATING', 'PROTECTED', 'RESOLVED', 'ARCHIVED'],
  DISCOVERY: ['INVESTIGATING', 'MONITORING', 'RESOLVED', 'ARCHIVED'],
  INVESTIGATING: ['RESOLVED', 'DISCOVERY', 'MONITORING', 'ARCHIVED'],
  RESOLVED: ['MONITORING', 'ARCHIVED', 'DISCOVERY'],
  FAILED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionAsset(from: string, to: string): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertAssetTransition(from: string, to: string): void {
  if (!canTransitionAsset(from, to)) {
    throw new Error(`Invalid asset lifecycle transition: ${from} → ${to}`);
  }
}

export function inferAssetType(mimeType: string, fileName?: string): 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO' | 'OTHER' {
  const mime = (mimeType || '').toLowerCase();
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic'].includes(ext)) {
    return 'IMAGE';
  }
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'].includes(ext)) {
    return 'VIDEO';
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(ext)) {
    return 'AUDIO';
  }
  if (
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('document') ||
    mime.includes('sheet') ||
    mime.includes('presentation') ||
    mime.includes('text') ||
    ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'txt', 'md', 'csv', 'rtf'].includes(ext)
  ) {
    return 'DOCUMENT';
  }
  return 'OTHER';
}
