/**
 * Audit subscriber — writes audit_events from platform events.
 * Modules that already audit directly set skipAudit: true.
 */

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { PlatformEventInput } from './types';

type AuditMapping = {
  eventType: string;
  filename?: string;
  fileType?: string;
};

const NAME_TO_AUDIT: Record<string, AuditMapping> = {
  'share.link.viewed':    { eventType: 'FILE_VIEWED' },
  'share.link.downloaded': { eventType: 'FILE_DOWNLOADED' },
  'share.link.forwarded': { eventType: 'FILE_SHARED' },
  'share.security.copy_attempt':       { eventType: 'SCREEN_CAPTURE_ATTEMPTED' },
  'share.security.screenshot_attempt': { eventType: 'SCREEN_CAPTURE_ATTEMPTED' },
  'share.security.print_attempt':      { eventType: 'SCREEN_CAPTURE_ATTEMPTED' },
  'share.policy.blocked':              { eventType: 'FILE_VIEWED' },
  'dna.generated':        { eventType: 'DNA_GENERATED' },
  'vault.stored':         { eventType: 'VAULT_STORED' },
  'certificate.issued':   { eventType: 'CERTIFICATE_ISSUED' },
  'duplicate.upload.blocked': { eventType: 'DUPLICATE_UPLOAD_ATTEMPT' },
  'duplicate.upload.admin_alert': { eventType: 'DUPLICATE_UPLOAD_ATTEMPT' },
  'investigation.completed':  { eventType: 'DNA_COMPARED' },
};

export async function handleAuditSubscriber(event: PlatformEventInput): Promise<void> {
  if (event.skipAudit) return;

  const mapping = NAME_TO_AUDIT[event.name];
  if (!mapping) return;

  try {
    await prisma.auditEvent.create({
      data: {
        eventType: mapping.eventType,
        userId: event.ownerUserId ?? event.actorUserId ?? null,
        dnaRecordId: event.dnaRecordId ?? null,
        vaultId: event.vaultId ?? null,
        filename: event.fileName ?? mapping.filename ?? null,
        fileType: mapping.fileType ?? null,
        ipAddress: event.ip ?? null,
        device: event.device ?? null,
        detail: {
          platformEvent: event.name,
          title: event.title,
          body: event.body,
          severity: event.severity,
          ...(event.payload ?? {}),
        } as object,
      },
    });
  } catch (err) {
    logger.warn('[AuditSubscriber] Failed', { name: event.name, error: String(err) });
  }
}
