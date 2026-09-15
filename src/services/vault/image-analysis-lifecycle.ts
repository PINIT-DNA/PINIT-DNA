/** Persistent image-analysis lifecycle for a protected vault record (one job per vault/version). */

export const IMAGE_ANALYSIS_STATUSES = [
  'NOT_ANALYZED',
  'PENDING',
  'ANALYZING',
  'COMPLETED',
  'FAILED',
  'NOT_APPLICABLE',
] as const;

export type ImageAnalysisStatus = (typeof IMAGE_ANALYSIS_STATUSES)[number];

export const STALE_ANALYZING_MS = 15 * 60 * 1000;

export function isCompletedAnalysisPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const verdict = row.verdict ?? row.label;
  const scores = row.scores;
  return Boolean(verdict) && Boolean(scores && typeof scores === 'object');
}

export function resolveImageAnalysisStatus(input: {
  mimeType: string;
  filename: string;
  storedStatus?: string | null;
  contentAnalysis?: unknown;
  analyzingStartedAt?: Date | string | null;
  now?: number;
}): ImageAnalysisStatus {
  const mime = (input.mimeType || '').toLowerCase();
  const name = (input.filename || '').toLowerCase();
  const isImage = mime.startsWith('image/') || /\.(jpe?g|png|webp|heic|tiff?|gif|bmp)$/i.test(name);
  if (!isImage) return 'NOT_APPLICABLE';

  if (isCompletedAnalysisPayload(input.contentAnalysis)) return 'COMPLETED';

  const stored = String(input.storedStatus || '').toUpperCase();
  if (stored === 'FAILED') return 'FAILED';
  if (stored === 'PENDING') return 'PENDING';
  if (stored === 'ANALYZING') {
    const started = input.analyzingStartedAt ? new Date(input.analyzingStartedAt).getTime() : 0;
    const now = input.now ?? Date.now();
    if (started && now - started > STALE_ANALYZING_MS) return 'FAILED';
    return 'ANALYZING';
  }
  return 'NOT_ANALYZED';
}
