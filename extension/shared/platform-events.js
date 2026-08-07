/**
 * Platform event types — adapters emit these; they never decide to protect.
 * Service-worker ES module.
 */

/** @typedef {'upload'|'export'|'drop'|'publish_complete'|'page_meta'|'surface_change'|'manual_protect'|'verify'|'self_test'} PlatformAction */

/**
 * @typedef {object} PlatformEvent
 * @property {string} platform
 * @property {PlatformAction} action
 * @property {number} [confidence]
 * @property {string} [fileName]
 * @property {string} [pageUrl]
 * @property {string} [postUrl]
 * @property {string} [uploader]
 * @property {string} [profileUrl]
 * @property {string} [platformSurface]
 * @property {string} [captureMethod]
 * @property {string} [dataUrl]
 * @property {string} [mediaUrl]
 * @property {string} [pageTitle]
 * @property {string} [caption]
 * @property {string} [platformPostId]
 * @property {string} [pipelineId]
 * @property {string} [clientRequestId]
 * @property {string} [capturedVia]
 * @property {string} [platformType]
 */

export const PLATFORM_ACTIONS = Object.freeze({
  UPLOAD: 'upload',
  EXPORT: 'export',
  DROP: 'drop',
  PUBLISH_COMPLETE: 'publish_complete',
  PAGE_META: 'page_meta',
  SURFACE_CHANGE: 'surface_change',
  MANUAL_PROTECT: 'manual_protect',
  VERIFY: 'verify',
  SELF_TEST: 'self_test',
});

/**
 * Normalize a loosely-shaped message into a PlatformEvent.
 * @param {Record<string, unknown>} raw
 * @returns {PlatformEvent}
 */
export function normalizePlatformEvent(raw = {}) {
  const action = String(raw.action || inferActionFromLegacy(raw) || 'upload').toLowerCase();
  return {
    platform: String(raw.platform || 'web').toLowerCase(),
    action: /** @type {PlatformAction} */ (action),
    confidence: Number(raw.confidence != null ? raw.confidence : 100),
    fileName: raw.fileName ? String(raw.fileName) : undefined,
    pageUrl: raw.pageUrl ? String(raw.pageUrl) : undefined,
    postUrl: raw.postUrl ? String(raw.postUrl) : undefined,
    uploader: raw.uploader || raw.ownerAccount ? String(raw.uploader || raw.ownerAccount) : undefined,
    profileUrl: raw.profileUrl ? String(raw.profileUrl) : undefined,
    platformSurface: raw.platformSurface ? String(raw.platformSurface) : undefined,
    captureMethod: raw.captureMethod ? String(raw.captureMethod) : undefined,
    dataUrl: raw.dataUrl ? String(raw.dataUrl) : undefined,
    mediaUrl: raw.mediaUrl ? String(raw.mediaUrl) : undefined,
    pageTitle: raw.pageTitle ? String(raw.pageTitle) : undefined,
    caption: raw.caption ? String(raw.caption) : undefined,
    platformPostId: raw.platformPostId ? String(raw.platformPostId) : undefined,
    pipelineId: raw.pipelineId ? String(raw.pipelineId) : undefined,
    clientRequestId: raw.clientRequestId ? String(raw.clientRequestId) : undefined,
    capturedVia: raw.capturedVia ? String(raw.capturedVia) : undefined,
    platformType: raw.platformType ? String(raw.platformType) : undefined,
  };
}

function inferActionFromLegacy(raw) {
  const via = String(raw.capturedVia || '').toLowerCase();
  const reason = String(raw.captureReason || '').toLowerCase();
  if (reason === 'manual' || via.includes('context_menu')) return 'manual_protect';
  if (reason === 'export' || via.includes('export')) return 'export';
  if (reason === 'self_test' || via.includes('self_test')) return 'self_test';
  if (via.includes('drop')) return 'drop';
  if (raw.type === 'REGISTER_POST' || raw.action === 'publish_complete') return 'publish_complete';
  return 'upload';
}
