/**
 * Intent Engine + Policy Engine — Event-Driven Protection Engine unit tests.
 * Mirrors extension/shared/intent-engine.js + policy-engine.js.
 */

const INTENT = {
  VIEW: 'VIEW',
  UPLOAD: 'UPLOAD',
  EXPORT: 'EXPORT',
  PUBLISH: 'PUBLISH',
  VERIFY: 'VERIFY',
  MANUAL_PROTECT: 'MANUAL_PROTECT',
  SELF_TEST: 'SELF_TEST',
};

function classifyIntent(event: { action?: string; confidence?: number }) {
  const action = String(event?.action || '').toLowerCase();
  const confidence = Number(event?.confidence != null ? event.confidence : 100);
  switch (action) {
    case 'verify':
      return { intent: INTENT.VERIFY, confidence };
    case 'manual_protect':
      return { intent: INTENT.MANUAL_PROTECT, confidence };
    case 'export':
      return { intent: INTENT.EXPORT, confidence };
    case 'publish_complete':
      return { intent: INTENT.PUBLISH, confidence };
    case 'self_test':
      return { intent: INTENT.SELF_TEST, confidence };
    case 'upload':
    case 'drop':
      return { intent: INTENT.UPLOAD, confidence };
    case 'page_meta':
    case 'surface_change':
      return { intent: INTENT.VIEW, confidence };
    default:
      return { intent: INTENT.VIEW, confidence: 0 };
  }
}

function createsAsset(intent: string) {
  return [INTENT.UPLOAD, INTENT.EXPORT, INTENT.PUBLISH, INTENT.MANUAL_PROTECT, INTENT.SELF_TEST].includes(
    intent,
  );
}

function evaluateProtectionPolicy(input: {
  intent: string;
  event: { platform?: string; dataUrl?: string; mediaUrl?: string; postUrl?: string };
  config?: { publishGuardianEnabled?: boolean; platforms?: Record<string, boolean> };
}) {
  const { intent, event, config = {} } = input;
  if (intent === INTENT.VIEW || intent === INTENT.VERIFY) {
    return { shouldProtect: false, shouldLinkOnly: false, reason: 'Viewer/Verify' };
  }
  if (intent === INTENT.PUBLISH && !event.dataUrl && !event.mediaUrl) {
    return { shouldProtect: false, shouldLinkOnly: true, reason: 'Link only' };
  }
  if (!createsAsset(intent)) {
    return { shouldProtect: false, shouldLinkOnly: false, reason: 'No asset' };
  }
  if (config.publishGuardianEnabled === false) {
    return { shouldProtect: false, shouldLinkOnly: false, reason: 'Disabled' };
  }
  const platform = String(event.platform || 'web');
  if (platform !== 'web' && config.platforms?.[platform] === false) {
    return { shouldProtect: false, shouldLinkOnly: false, reason: 'Platform off' };
  }
  if (!event.dataUrl && !event.mediaUrl) {
    return { shouldProtect: false, shouldLinkOnly: false, reason: 'No media' };
  }
  return { shouldProtect: true, shouldLinkOnly: false, reason: 'Allow' };
}

describe('Intent Engine', () => {
  it('maps upload/drop to UPLOAD (creates asset)', () => {
    expect(classifyIntent({ action: 'upload' }).intent).toBe(INTENT.UPLOAD);
    expect(classifyIntent({ action: 'drop' }).intent).toBe(INTENT.UPLOAD);
    expect(createsAsset(INTENT.UPLOAD)).toBe(true);
  });

  it('maps view/surface to VIEW (no asset)', () => {
    expect(classifyIntent({ action: 'surface_change' }).intent).toBe(INTENT.VIEW);
    expect(createsAsset(INTENT.VIEW)).toBe(false);
    expect(createsAsset(INTENT.VERIFY)).toBe(false);
  });

  it('maps manual_protect and export correctly', () => {
    expect(classifyIntent({ action: 'manual_protect' }).intent).toBe(INTENT.MANUAL_PROTECT);
    expect(classifyIntent({ action: 'export' }).intent).toBe(INTENT.EXPORT);
    expect(createsAsset(INTENT.MANUAL_PROTECT)).toBe(true);
    expect(createsAsset(INTENT.EXPORT)).toBe(true);
  });
});

describe('Protection Policy Engine', () => {
  it('denies VIEW even with media present', () => {
    const d = evaluateProtectionPolicy({
      intent: INTENT.VIEW,
      event: { platform: 'youtube', dataUrl: 'data:...' },
    });
    expect(d.shouldProtect).toBe(false);
  });

  it('allows UPLOAD with media when guardian on', () => {
    const d = evaluateProtectionPolicy({
      intent: INTENT.UPLOAD,
      event: { platform: 'youtube', dataUrl: 'data:...' },
      config: { publishGuardianEnabled: true },
    });
    expect(d.shouldProtect).toBe(true);
  });

  it('link-only for PUBLISH without bytes', () => {
    const d = evaluateProtectionPolicy({
      intent: INTENT.PUBLISH,
      event: { platform: 'youtube', postUrl: 'https://youtube.com/watch?v=1' },
    });
    expect(d.shouldProtect).toBe(false);
    expect(d.shouldLinkOnly).toBe(true);
  });

  it('respects platform toggle off', () => {
    const d = evaluateProtectionPolicy({
      intent: INTENT.UPLOAD,
      event: { platform: 'instagram', dataUrl: 'data:...' },
      config: { publishGuardianEnabled: true, platforms: { instagram: false } },
    });
    expect(d.shouldProtect).toBe(false);
  });
});
