/**
 * Intent Engine — gatekeeper. Adapters never set intent; only this module does.
 *
 * VIEW / VERIFY → never create Asset
 * UPLOAD / EXPORT / PUBLISH / MANUAL_PROTECT / SELF_TEST → may create Asset
 */

import { PLATFORM_ACTIONS } from './platform-events.js';

/** @typedef {'VIEW'|'UPLOAD'|'EXPORT'|'PUBLISH'|'VERIFY'|'MANUAL_PROTECT'|'SELF_TEST'} ProtectionIntent */

export const INTENT = Object.freeze({
  VIEW: 'VIEW',
  UPLOAD: 'UPLOAD',
  EXPORT: 'EXPORT',
  PUBLISH: 'PUBLISH',
  VERIFY: 'VERIFY',
  MANUAL_PROTECT: 'MANUAL_PROTECT',
  SELF_TEST: 'SELF_TEST',
});

/** Intents that may create an Asset / run protection pipeline */
const ASSET_INTENTS = new Set([
  INTENT.UPLOAD,
  INTENT.EXPORT,
  INTENT.PUBLISH,
  INTENT.MANUAL_PROTECT,
  INTENT.SELF_TEST,
]);

/**
 * Classify a platform event into a ProtectionIntent.
 * @param {import('./platform-events.js').PlatformEvent} event
 * @returns {{ intent: ProtectionIntent, confidence: number, rationale: string }}
 */
export function classifyIntent(event) {
  const action = String(event?.action || '').toLowerCase();
  const confidence = Number(event?.confidence != null ? event.confidence : 100);

  switch (action) {
    case PLATFORM_ACTIONS.VERIFY:
      return { intent: INTENT.VERIFY, confidence, rationale: 'User requested verify only' };
    case PLATFORM_ACTIONS.MANUAL_PROTECT:
      return { intent: INTENT.MANUAL_PROTECT, confidence, rationale: 'Explicit manual protect' };
    case PLATFORM_ACTIONS.EXPORT:
      return { intent: INTENT.EXPORT, confidence, rationale: 'Export / download protect gesture' };
    case PLATFORM_ACTIONS.PUBLISH_COMPLETE:
      return { intent: INTENT.PUBLISH, confidence, rationale: 'Publish completed — link public URL' };
    case PLATFORM_ACTIONS.SELF_TEST:
      return { intent: INTENT.SELF_TEST, confidence, rationale: 'Pipeline self-test' };
    case PLATFORM_ACTIONS.UPLOAD:
    case PLATFORM_ACTIONS.DROP:
      return { intent: INTENT.UPLOAD, confidence, rationale: 'Creator upload / drop on allowlisted surface' };
    case PLATFORM_ACTIONS.PAGE_META:
    case PLATFORM_ACTIONS.SURFACE_CHANGE:
      return { intent: INTENT.VIEW, confidence, rationale: 'Browsing / surface metadata only' };
    default:
      return { intent: INTENT.VIEW, confidence: 0, rationale: `Unknown action "${action}" → VIEW (deny)` };
  }
}

/**
 * @param {ProtectionIntent} intent
 */
export function createsAsset(intent) {
  return ASSET_INTENTS.has(intent);
}

/**
 * Map intent → forensic WHY fields stored on Asset / ProtectedPost metadata.
 * @param {ProtectionIntent} intent
 * @param {import('./platform-events.js').PlatformEvent} event
 */
export function intentToCaptureMeta(intent, event = {}) {
  const method =
    event.captureMethod ||
    (event.action === 'drop'
      ? 'drop'
      : event.action === 'export'
        ? 'export-gesture'
        : event.action === 'manual_protect'
          ? 'context-menu'
          : event.action === 'self_test'
            ? 'self-test'
            : 'file-picker');

  switch (intent) {
    case INTENT.MANUAL_PROTECT:
      return {
        captureReason: 'manual',
        ownerAction: 'protect',
        captureMethod: method,
      };
    case INTENT.EXPORT:
      return {
        captureReason: 'export',
        ownerAction: 'export',
        captureMethod: method,
      };
    case INTENT.SELF_TEST:
      return {
        captureReason: 'self_test',
        ownerAction: 'self_test',
        captureMethod: 'self-test',
      };
    case INTENT.PUBLISH:
      return {
        captureReason: 'publish',
        ownerAction: 'upload',
        captureMethod: method,
      };
    case INTENT.UPLOAD:
      return {
        captureReason: 'publish',
        ownerAction: 'upload',
        captureMethod: method,
      };
    default:
      return {
        captureReason: 'view',
        ownerAction: 'none',
        captureMethod: method,
      };
  }
}
