/**
 * Timeline subscriber — appends forensic provenance from platform events.
 * Modules that already write provenance directly set skipTimeline: true.
 */

import { forensicProvenanceService } from '../forensics/forensic-provenance.service';
import { logger } from '../../lib/logger';
import type { PlatformEventInput } from './types';

const NAME_TO_PROVENANCE: Record<string, string> = {
  'share.link.created':   'SHARED',
  'share.link.viewed':    'OPENED',
  'share.link.downloaded': 'DOWNLOADED',
  'share.link.forwarded': 'FORWARDED',
  'share.link.revoked':   'REVOKED',
  'share.security.copy_attempt':       'OPENED',
  'share.security.screenshot_attempt': 'OPENED',
  'share.security.print_attempt':      'OPENED',
  'share.policy.blocked':              'OPENED',
  'monitoring.match.found':            'CRAWLER_DETECTION',
};

export async function handleTimelineSubscriber(event: PlatformEventInput): Promise<void> {
  if (event.skipTimeline) return;

  const eventType = NAME_TO_PROVENANCE[event.name];
  if (!eventType) return;

  const entityId = event.shareLinkId ?? event.entityId;
  const dedupeKey = event.dedupeKey ?? `uee:${event.name}:${entityId}:${new Date().toISOString().slice(0, 16)}`;

  try {
    await forensicProvenanceService.append({
      eventType,
      summary: event.body || event.title,
      dnaRecordId: event.dnaRecordId ?? null,
      vaultId: event.vaultId ?? null,
      certificateId: event.certificateId ?? null,
      shareLinkId: event.shareLinkId ?? (event.entityType === 'share_link' ? event.entityId : null),
      investigationId: event.investigationId ?? null,
      actorUserId: event.actorUserId ?? null,
      country: event.country ?? null,
      ipAddress: event.ip ?? null,
      device: event.device ?? null,
      payload: (event.payload ?? { platformEvent: event.name }) as Record<string, unknown>,
      dedupeKey,
    });
  } catch (err) {
    logger.warn('[TimelineSubscriber] Failed', { name: event.name, error: String(err) });
  }
}
