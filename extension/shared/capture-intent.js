/**
 * Capture-intent helpers for the service worker (ES module).
 * Content scripts use the classic PinITAdapter helpers in adapter-interface.js.
 *
 * Core rule: Viewing ≠ Owning ≠ Publishing ≠ Protecting
 */

/** @typedef {'publish'|'export'|'manual'|'self_test'} CaptureReason */
/** @typedef {'upload'|'export'|'protect'|'self_test'} OwnerAction */
/** @typedef {'file-picker'|'drop'|'export-gesture'|'context-menu'|'main-hook'|'self-test'|'unknown'} CaptureMethod */
/** @typedef {'social'|'creator'|'business'|'photo'|'web'} PlatformType */

const PLATFORM_TYPES = {
  instagram: 'social',
  facebook: 'social',
  x: 'social',
  pinterest: 'social',
  linkedin: 'business',
  telegram: 'social',
  youtube: 'social',
  tiktok: 'social',
  github: 'business',
  threads: 'creator',
  vimeo: 'creator',
  twitch: 'creator',
  reddit: 'creator',
  tumblr: 'creator',
  medium: 'creator',
  substack: 'creator',
  patreon: 'creator',
  behance: 'creator',
  dribbble: 'creator',
  artstation: 'creator',
  deviantart: 'creator',
  flickr: 'photo',
  '500px': 'photo',
  smugmug: 'photo',
  pixieset: 'photo',
  zenfolio: 'photo',
  adobe_portfolio: 'photo',
  squarespace: 'photo',
  wix: 'photo',
  canva: 'business',
  figma: 'business',
  adobe_express: 'business',
  adobe_photoshop: 'business',
  adobe_illustrator: 'business',
  shopify: 'business',
  wordpress: 'business',
};

/**
 * Derive structured intent from legacy capturedVia + optional explicit fields.
 * @param {Record<string, unknown>} message
 */
export function resolveCaptureIntent(message = {}) {
  const via = String(message.capturedVia || '').toLowerCase();
  const platform = String(message.platform || 'web').toLowerCase();

  /** @type {CaptureReason} */
  let captureReason = /** @type {CaptureReason} */ (message.captureReason || null);
  /** @type {OwnerAction} */
  let ownerAction = /** @type {OwnerAction} */ (message.ownerAction || null);
  /** @type {CaptureMethod} */
  let captureMethod = /** @type {CaptureMethod} */ (message.captureMethod || null);

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
    /** @type {PlatformType} */ (message.platformType) ||
    PLATFORM_TYPES[platform] ||
    'web';

  return {
    captureReason,
    ownerAction,
    captureMethod,
    platformType,
    capturedVia: message.capturedVia || `extension_${captureReason}`,
  };
}

/**
 * Auto-protect is only allowed for creator intent (publish/export/self_test).
 * Manual protect is always allowed (explicit user request).
 * @param {ReturnType<typeof resolveCaptureIntent>} intent
 */
export function isAllowedAutoProtect(intent) {
  if (!intent) return false;
  if (intent.captureReason === 'manual') return true;
  if (intent.captureReason === 'self_test') return true;
  if (intent.captureReason === 'publish' || intent.captureReason === 'export') return true;
  return false;
}

export function platformTypeFor(platformId) {
  return PLATFORM_TYPES[String(platformId || '').toLowerCase()] || 'web';
}
