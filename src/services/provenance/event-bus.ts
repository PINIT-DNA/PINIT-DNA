/**
 * Lightweight in-process event bus for forensic provenance.
 * Tracking stays outside DNA / investigation / acceptance engines.
 */
import { logger } from '../../lib/logger';

export type ProvenanceBusEvent =
  | 'download.recorded'
  | 'tep.created'
  | 'tep.revoked'
  | 'share.recorded'
  | 'access.recorded'
  | 'tamper.recorded'
  | 'investigation.recorded'
  | 'creation.recorded';

type Handler = (payload: Record<string, unknown>) => void | Promise<void>;

const handlers = new Map<ProvenanceBusEvent, Set<Handler>>();

export const provenanceEventBus = {
  on(event: ProvenanceBusEvent, handler: Handler): () => void {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
    return () => handlers.get(event)?.delete(handler);
  },

  async emit(event: ProvenanceBusEvent, payload: Record<string, unknown>): Promise<void> {
    const set = handlers.get(event);
    if (!set?.size) return;
    for (const handler of set) {
      try {
        await handler(payload);
      } catch (err) {
        logger.warn('[ProvenanceEventBus] handler failed (non-fatal)', {
          event,
          error: String(err),
        });
      }
    }
  },
};
