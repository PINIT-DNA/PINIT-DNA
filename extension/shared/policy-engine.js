/**
 * Protection Policy Engine — decides Should Protect? after Intent classification.
 * Adapters never call this; only the service worker / orchestrator does.
 */

import { INTENT, createsAsset, intentToCaptureMeta } from './intent-engine.js';

/**
 * @typedef {object} PolicyDecision
 * @property {boolean} shouldProtect
 * @property {boolean} shouldLinkOnly
 * @property {boolean} enrollMonitoring
 * @property {boolean} issueCertificate
 * @property {string} reason
 * @property {string} [captureReason]
 * @property {string} [ownerAction]
 * @property {string} [captureMethod]
 * @property {object} [preview]
 */

/**
 * @param {{
 *   intent: import('./intent-engine.js').ProtectionIntent,
 *   intentRationale?: string,
 *   event: import('./platform-events.js').PlatformEvent,
 *   config?: { publishGuardianEnabled?: boolean, platforms?: Record<string, boolean> },
 *   signedIn?: boolean,
 * }} input
 * @returns {PolicyDecision}
 */
export function evaluateProtectionPolicy(input) {
  const { intent, intentRationale, event, config = {}, signedIn = false } = input;
  const platform = String(event.platform || 'web').toLowerCase();
  const meta = intentToCaptureMeta(intent, event);

  const previewBase = {
    platform,
    action: event.action,
    intent,
    fileName: event.fileName || null,
    pageUrl: event.pageUrl || null,
    platformSurface: event.platformSurface || null,
  };

  if (intent === INTENT.VIEW || intent === INTENT.VERIFY) {
    return {
      shouldProtect: false,
      shouldLinkOnly: false,
      enrollMonitoring: false,
      issueCertificate: false,
      reason:
        intent === INTENT.VERIFY
          ? 'Verify only — no Asset created'
          : intentRationale || 'Viewer Mode — browsing is not ownership',
      ...meta,
      preview: {
        ...previewBase,
        willProtect: false,
        vault: false,
        monitoring: false,
        label: 'Viewer Mode',
      },
    };
  }

  if (intent === INTENT.PUBLISH && !event.dataUrl && !event.mediaUrl) {
    // Late URL bind — no new file bytes
    return {
      shouldProtect: false,
      shouldLinkOnly: true,
      enrollMonitoring: true,
      issueCertificate: false,
      reason: 'Publish complete — link platform URL to existing Asset',
      ...meta,
      preview: {
        ...previewBase,
        willProtect: false,
        willLink: true,
        vault: false,
        monitoring: true,
        label: 'Link platform URL',
      },
    };
  }

  if (!createsAsset(intent)) {
    return {
      shouldProtect: false,
      shouldLinkOnly: false,
      enrollMonitoring: false,
      issueCertificate: false,
      reason: `Intent ${intent} does not create Assets`,
      ...meta,
      preview: {
        ...previewBase,
        willProtect: false,
        vault: false,
        monitoring: false,
        label: 'Ignored',
      },
    };
  }

  if (config.publishGuardianEnabled === false) {
    return {
      shouldProtect: false,
      shouldLinkOnly: false,
      enrollMonitoring: false,
      issueCertificate: false,
      reason: 'Publish Guardian disabled in options',
      ...meta,
      preview: {
        ...previewBase,
        willProtect: false,
        vault: false,
        monitoring: false,
        label: 'Guardian off',
      },
    };
  }

  if (platform !== 'web' && config.platforms && config.platforms[platform] === false) {
    return {
      shouldProtect: false,
      shouldLinkOnly: false,
      enrollMonitoring: false,
      issueCertificate: false,
      reason: `Platform ${platform} disabled in options`,
      ...meta,
      preview: {
        ...previewBase,
        willProtect: false,
        vault: false,
        monitoring: false,
        label: 'Platform off',
      },
    };
  }

  if (!signedIn && intent !== INTENT.SELF_TEST) {
    // Still allow queueing when offline path handles auth later — policy says protect intended
    // but SW must ensure queue or reject. We mark shouldProtect true only if media present;
    // SW queues when unsigned.
  }

  if (!event.dataUrl && !event.mediaUrl && intent !== INTENT.PUBLISH) {
    return {
      shouldProtect: false,
      shouldLinkOnly: false,
      enrollMonitoring: false,
      issueCertificate: false,
      reason: 'No media bytes in event',
      ...meta,
      preview: {
        ...previewBase,
        willProtect: false,
        vault: false,
        monitoring: false,
        label: 'No media',
      },
    };
  }

  const reasonByIntent = {
    [INTENT.UPLOAD]: 'Creator upload — will protect',
    [INTENT.EXPORT]: 'Export protect — will protect',
    [INTENT.MANUAL_PROTECT]: 'Manual protect — will protect',
    [INTENT.SELF_TEST]: 'Self-test — will protect',
    [INTENT.PUBLISH]: 'Publish — will protect',
  };

  return {
    shouldProtect: true,
    shouldLinkOnly: false,
    enrollMonitoring: true,
    issueCertificate: true,
    reason: reasonByIntent[intent] || intentRationale || 'Policy allow',
    ...meta,
    preview: {
      ...previewBase,
      willProtect: true,
      vault: true,
      monitoring: true,
      label: 'Creator Mode',
      reason: reasonByIntent[intent],
    },
  };
}

/**
 * Build Protection Preview for popup (no file required).
 * @param {{ mode: 'VIEWER'|'CREATOR', platform: string, pageUrl?: string, platformSurface?: string, fileName?: string }} surface
 */
export function buildSurfacePreview(surface) {
  const isCreator = surface.mode === 'CREATOR';
  return {
    at: Date.now(),
    platform: surface.platform || 'web',
    pageUrl: surface.pageUrl || null,
    platformSurface: surface.platformSurface || null,
    fileName: surface.fileName || null,
    action: isCreator ? 'upload' : 'view',
    intent: isCreator ? INTENT.UPLOAD : INTENT.VIEW,
    willProtect: isCreator,
    vault: isCreator,
    monitoring: isCreator,
    reason: isCreator
      ? 'Creator upload surface — files you select will be protected'
      : 'Viewer Mode — browsing / watching will not protect',
    label: isCreator ? 'Creator Mode' : 'Viewer Mode',
  };
}
