/**
 * Capture-intent resolution — creator-first security boundary.
 * Mirrors extension/shared/capture-intent.js (no Chrome dependency).
 */

type CaptureReason = 'publish' | 'export' | 'manual' | 'self_test';
type OwnerAction = 'upload' | 'export' | 'protect' | 'self_test';
type CaptureMethod =
  | 'file-picker'
  | 'drop'
  | 'export-gesture'
  | 'context-menu'
  | 'main-hook'
  | 'self-test'
  | 'unknown';

const PLATFORM_TYPES: Record<string, string> = {
  youtube: 'social',
  instagram: 'social',
  canva: 'business',
};

function resolveCaptureIntent(message: Record<string, unknown> = {}) {
  const via = String(message.capturedVia || '').toLowerCase();
  const platform = String(message.platform || 'web').toLowerCase();

  let captureReason = (message.captureReason as CaptureReason | null) || null;
  let ownerAction = (message.ownerAction as OwnerAction | null) || null;
  let captureMethod = (message.captureMethod as CaptureMethod | null) || null;

  if (!captureReason) {
    if (via.includes('self_test')) captureReason = 'self_test';
    else if (via.includes('context_menu') || via.includes('manual')) captureReason = 'manual';
    else if (via.includes('export')) captureReason = 'export';
    else captureReason = 'publish';
  }

  if (!ownerAction) {
    if (captureReason === 'manual') ownerAction = 'protect';
    else if (captureReason === 'export') ownerAction = 'export';
    else if (captureReason === 'self_test') ownerAction = 'self_test';
    else ownerAction = 'upload';
  }

  if (!captureMethod) {
    if (via.includes('context_menu')) captureMethod = 'context-menu';
    else if (via.includes('export')) captureMethod = 'export-gesture';
    else if (via.includes('drop')) captureMethod = 'drop';
    else if (via.includes('main') || via.includes('youtube_main')) captureMethod = 'main-hook';
    else if (via.includes('self_test')) captureMethod = 'self-test';
    else if (via.includes('input') || via.includes('file')) captureMethod = 'file-picker';
    else captureMethod = 'unknown';
  }

  const platformType =
    (message.platformType as string) || PLATFORM_TYPES[platform] || 'web';

  return {
    captureReason,
    ownerAction,
    captureMethod,
    platformType,
    capturedVia: (message.capturedVia as string) || `extension_${captureReason}`,
  };
}

function isAllowedAutoProtect(intent: ReturnType<typeof resolveCaptureIntent>) {
  if (!intent) return false;
  return ['manual', 'self_test', 'publish', 'export'].includes(intent.captureReason);
}

function isYouTubeStudioSurface(hostname: string, pathname: string) {
  const host = hostname.replace(/^www\./, '');
  if (host === 'studio.youtube.com') return true;
  if (host.endsWith('youtube.com') && /\/(upload|create)(\/|$)/i.test(pathname)) return true;
  return false;
}

describe('capture intent', () => {
  it('classifies context-menu as manual protect', () => {
    const intent = resolveCaptureIntent({
      platform: 'web',
      capturedVia: 'extension_context_menu',
    });
    expect(intent.captureReason).toBe('manual');
    expect(intent.ownerAction).toBe('protect');
    expect(intent.captureMethod).toBe('context-menu');
    expect(isAllowedAutoProtect(intent)).toBe(true);
  });

  it('classifies publish file-picker as upload', () => {
    const intent = resolveCaptureIntent({
      platform: 'youtube',
      capturedVia: 'extension_publish_guardian_input',
    });
    expect(intent.captureReason).toBe('publish');
    expect(intent.ownerAction).toBe('upload');
    expect(intent.captureMethod).toBe('file-picker');
    expect(intent.platformType).toBe('social');
  });

  it('classifies export protect', () => {
    const intent = resolveCaptureIntent({
      platform: 'canva',
      capturedVia: 'extension_export_protect',
    });
    expect(intent.captureReason).toBe('export');
    expect(intent.ownerAction).toBe('export');
    expect(intent.captureMethod).toBe('export-gesture');
    expect(intent.platformType).toBe('business');
  });
});

describe('YouTube creator surface allowlist', () => {
  it('allows Studio and upload routes only', () => {
    expect(isYouTubeStudioSurface('studio.youtube.com', '/')).toBe(true);
    expect(isYouTubeStudioSurface('youtube.com', '/upload')).toBe(true);
    expect(isYouTubeStudioSurface('www.youtube.com', '/create')).toBe(true);
  });

  it('denies watch, shorts, home, search, channel', () => {
    expect(isYouTubeStudioSurface('www.youtube.com', '/watch?v=abc')).toBe(false);
    expect(isYouTubeStudioSurface('www.youtube.com', '/shorts/xyz')).toBe(false);
    expect(isYouTubeStudioSurface('www.youtube.com', '/')).toBe(false);
    expect(isYouTubeStudioSurface('www.youtube.com', '/results')).toBe(false);
    expect(isYouTubeStudioSurface('www.youtube.com', '/@channel')).toBe(false);
  });
});
