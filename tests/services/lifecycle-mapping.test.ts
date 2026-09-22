/**
 * Lifecycle vocabulary — what maps to what.
 *
 * The rule the product depends on: an event exists only because the action happened.
 * So the map must cover the events modules really emit, must NOT invent types for
 * actions the backend never sees, and must read the payload where the meaning of an
 * event depends on what actually occurred.
 */
import { describe, test, expect } from '@jest/globals';
import {
  LIFECYCLE_TYPES,
  LIFECYCLE_STAGE_OF,
  LIFECYCLE_LABEL,
  LIFECYCLE_TYPES_NOT_EMITTED,
  lifecycleTypeForPlatformEvent,
  lifecycleTypeForTimelineEvent,
  isLifecycleType,
} from '../../src/services/lifecycle/lifecycle-types';

describe('lifecycle vocabulary', () => {
  test('every type has a stage and a plain label', () => {
    for (const type of LIFECYCLE_TYPES) {
      expect(LIFECYCLE_STAGE_OF[type]).toBeDefined();
      expect(LIFECYCLE_LABEL[type]).toBeTruthy();
      expect(LIFECYCLE_LABEL[type]).not.toBe(type);
    }
  });

  test('types with no backend action behind them are declared, not hidden', () => {
    expect(LIFECYCLE_TYPES_NOT_EMITTED).toContain('ASSET_ACCESSED');
    expect(LIFECYCLE_TYPES_NOT_EMITTED).toContain('PURCHASE_DOWNLOADED');
  });

  test('isLifecycleType rejects anything not in the vocabulary', () => {
    expect(isLifecycleType('ASSET_PROTECTED')).toBe(true);
    expect(isLifecycleType('ASSET_TELEPORTED')).toBe(false);
    expect(isLifecycleType(null)).toBe(false);
  });
});

describe('platform events map to lifecycle types', () => {
  test.each([
    ['vault.stored', 'ASSET_PROTECTED'],
    ['vault.deleted', 'ASSET_DELETED'],
    ['vault.previewed', 'ASSET_VIEWED'],
    ['vault.retrieved', 'ASSET_DOWNLOADED'],
    ['vault.protected_download.completed', 'ASSET_DOWNLOADED'],
    ['share.link.created', 'SHARE_LINK_CREATED'],
    ['share.link.viewed', 'SHARE_LINK_OPENED'],
    ['share.link.downloaded', 'SHARE_LINK_DOWNLOADED'],
    ['share.link.revoked', 'SHARE_LINK_REVOKED'],
    ['share.link.expired', 'SHARE_LINK_EXPIRED'],
    ['certificate.issued', 'CERTIFICATE_ISSUED'],
    ['certificate.verified', 'CERTIFICATE_VERIFIED'],
    ['certificate.revoked', 'CERTIFICATE_REVOKED'],
    ['portfolio.viewed', 'PORTFOLIO_VIEWED'],
    ['monitoring.match.found', 'MONITORING_MATCH_FOUND'],
    ['investigation.started', 'INVESTIGATION_STARTED'],
    ['investigation.completed', 'INVESTIGATION_COMPLETED'],
    ['evidence.generated', 'EVIDENCE_GENERATED'],
  ])('%s -> %s', (name, expected) => {
    expect(lifecycleTypeForPlatformEvent({ name })).toBe(expected);
  });

  test('a protected download is one download, not two', () => {
    // The "ready" event fires when the tracked export package is built; only the
    // completed one means a file reached the owner.
    expect(lifecycleTypeForPlatformEvent({ name: 'vault.protected_download.ready' })).toBeNull();
    expect(lifecycleTypeForPlatformEvent({ name: 'vault.protected_download.completed' })).toBe('ASSET_DOWNLOADED');
  });

  test('events that are not lifecycle events map to nothing', () => {
    for (const name of ['dna.generated', 'monitoring.scan.completed', 'share.security.copy_attempt', 'automation.completed']) {
      expect(lifecycleTypeForPlatformEvent({ name })).toBeNull();
    }
  });

  test('a discovery is suspicious use only when the copy is tampered or high risk', () => {
    expect(lifecycleTypeForPlatformEvent({
      name: 'publish_guardian.discovery',
      payload: { tampered: false, riskScore: 10 },
    })).toBe('MONITORING_MATCH_FOUND');

    expect(lifecycleTypeForPlatformEvent({
      name: 'publish_guardian.discovery',
      payload: { tampered: true, riskScore: 10 },
    })).toBe('SUSPICIOUS_USE_DETECTED');

    expect(lifecycleTypeForPlatformEvent({
      name: 'publish_guardian.discovery',
      payload: { tampered: false, riskScore: 92 },
    })).toBe('SUSPICIOUS_USE_DETECTED');
  });

  test('a blocked duplicate is suspicious use only when another account did it', () => {
    expect(lifecycleTypeForPlatformEvent({
      name: 'duplicate.upload.blocked',
      payload: { crossUser: true },
    })).toBe('SUSPICIOUS_USE_DETECTED');

    expect(lifecycleTypeForPlatformEvent({
      name: 'duplicate.upload.blocked',
      payload: { crossUser: false },
    })).toBeNull();
  });

  test('an explicit lifecycle type wins, but only a real one', () => {
    expect(lifecycleTypeForPlatformEvent({ name: 'anything', lifecycleType: 'EVIDENCE_SHARED' })).toBe('EVIDENCE_SHARED');
    expect(lifecycleTypeForPlatformEvent({ name: 'anything', lifecycleType: 'NOT_A_TYPE' })).toBeNull();
  });
});

describe('existing asset timeline rows map to lifecycle types', () => {
  test.each([
    ['PROTECTED', 'ASSET_PROTECTED'],
    ['CERTIFICATE', 'CERTIFICATE_ISSUED'],
    ['LISTED', 'ASSET_LISTED'],
    ['UNLISTED', 'ASSET_UNLISTED'],
    ['SOLD', 'ASSET_PURCHASED'],
    ['LICENSE_CREATED', 'LICENSE_CREATED'],
    ['DOWNLOADED', 'PURCHASE_DOWNLOADED'],
    ['SHARE_VIEWED', 'SHARE_LINK_OPENED'],
    ['DISCOVERY', 'MONITORING_MATCH_FOUND'],
    ['TAMPERING', 'SUSPICIOUS_USE_DETECTED'],
  ])('%s -> %s', (eventType, expected) => {
    expect(lifecycleTypeForTimelineEvent(eventType)).toBe(expected);
  });

  test('bookkeeping rows are not lifecycle events', () => {
    for (const type of ['NOTE', 'STATUS_CHANGE', 'CREATED', 'PRICE_CHANGED']) {
      expect(lifecycleTypeForTimelineEvent(type)).toBeNull();
    }
  });
});
