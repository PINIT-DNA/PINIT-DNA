/**
 * How an asset entered PINIT Protect. Stored on DNA pinitProtect.captureMethod.
 * Never infer camera vs upload from EXIF timestamps.
 */
export type ProtectOriginKind = 'upload' | 'camera' | 'unknown';

export function classifyProtectOrigin(method: string | null | undefined): ProtectOriginKind {
  const m = (method || '').trim().toLowerCase();
  if (!m) return 'unknown';
  if (m === 'upload' || m.startsWith('upload') || m.includes('gallery') || m.includes('file-picker')) {
    return 'upload';
  }
  if (
    m.includes('camera')
    || m.includes('secure capture')
    || m.includes('video capture')
    || m.includes('document scan')
    || m.includes('audio capture')
  ) {
    return 'camera';
  }
  return 'unknown';
}

export function capturedViaForProtect(method: string | null | undefined): string {
  const kind = classifyProtectOrigin(method);
  if (kind === 'camera') return 'hub_protect_camera';
  if (kind === 'upload') return 'hub_protect_upload';
  return 'hub_protect_file';
}

export function protectOriginLabel(method: string | null | undefined): string | null {
  const kind = classifyProtectOrigin(method);
  if (kind === 'upload') return 'Uploaded to PINIT Protect';
  if (kind === 'camera') {
    const m = (method || '').toLowerCase();
    if (m.includes('video')) return 'Captured with the PINIT camera (video)';
    if (m.includes('scan') || m.includes('document')) return 'Captured with the PINIT camera (document scan)';
    if (m.includes('audio')) return 'Captured with the PINIT camera (audio)';
    return 'Captured with the PINIT camera';
  }
  return method?.trim() || null;
}
