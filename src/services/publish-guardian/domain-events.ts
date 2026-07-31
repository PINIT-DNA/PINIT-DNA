/**
 * In-process domain event bus for Publish Guardian.
 * Subscribers are independent — failures never break the publisher.
 */

import { logger } from '../../lib/logger';

export type PublishGuardianDomainEvent =
  | { type: 'PostProtected'; protectedPostId: string; ownerUserId: string; vaultId: string; dnaRecordId: string; certificateId: string | null; platform: string }
  | { type: 'MonitoringEnrolled'; protectedPostId: string; ownerUserId: string; monitorRecordId: string; watchUrls: string[] }
  | { type: 'MonitoringFailed'; protectedPostId: string; ownerUserId: string; error: string }
  | { type: 'DiscoveryFound'; protectedPostId: string; ownerUserId: string; discoveryId: string; discoveryUrl: string; riskScore: number; severity: string; tampered: boolean }
  | { type: 'TamperingDetected'; protectedPostId: string; ownerUserId: string; discoveryId: string; riskScore: number }
  | { type: 'InvestigationCompleted'; protectedPostId: string; ownerUserId: string; investigationId: string }
  | { type: 'CertificateIssued'; protectedPostId: string; ownerUserId: string; certificateId: string }
  | { type: 'LifecycleChanged'; protectedPostId: string; ownerUserId: string; from: string; to: string }
  | { type: 'PostResolved'; protectedPostId: string; ownerUserId: string };

type Handler = (event: PublishGuardianDomainEvent) => void | Promise<void>;

const handlers = new Map<PublishGuardianDomainEvent['type'] | '*', Set<Handler>>();

export const publishGuardianEvents = {
  on(type: PublishGuardianDomainEvent['type'] | '*', handler: Handler): () => void {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(handler);
    return () => handlers.get(type)?.delete(handler);
  },

  async emit(event: PublishGuardianDomainEvent): Promise<void> {
    const set = new Set<Handler>([
      ...(handlers.get(event.type) ?? []),
      ...(handlers.get('*') ?? []),
    ]);
    for (const h of set) {
      try {
        await h(event);
      } catch (err) {
        logger.warn('[PublishGuardianEvents] subscriber failed', {
          type: event.type,
          error: String(err),
        });
      }
    }
  },
};
