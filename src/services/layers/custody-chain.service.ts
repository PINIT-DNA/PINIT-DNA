/**
 * Layer 13's custody chain used to write exactly one entry (FILE_REGISTERED)
 * at DNA-generation time and never grow — "chain" in name only. This makes
 * it a real, appendable chain: any genuinely custody-relevant event in the
 * file's life can call appendCustodyEvent to add to it.
 *
 * 2026-09-23: reconciled with ForensicProvenanceEvent (the append-only
 * system powering the investigation PDF's real Chain of Custody exhibit).
 * They used to be two disconnected systems — Layer 13 only grew on
 * blocked-duplicate events, while investigation reports read exclusively
 * from ForensicProvenanceEvent, so Layer 13 never reflected what
 * investigations actually showed. Now forensic-provenance.service.ts's
 * append() calls this function for every event it records, so both stay
 * in sync from one write. Direct callers of appendCustodyEvent (like
 * duplicate-check.service.ts's block path) still work exactly as before —
 * this file's own contract hasn't changed, only who else calls it.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface CustodyEvent {
  event: string;
  actor?: string;
  detail?: Record<string, unknown>;
}

export async function appendCustodyEvent(dnaRecordId: string, event: CustodyEvent): Promise<void> {
  try {
    const existing = await prisma.custodyLayer.findUnique({
      where: { dnaRecordId },
      select: { custodyChain: true },
    });
    if (!existing) return; // no Layer 13 row for this record — nothing to append to

    const chain = Array.isArray(existing.custodyChain) ? existing.custodyChain : [];
    const entry = {
      event: event.event,
      timestamp: new Date().toISOString(),
      actor: event.actor ?? 'system',
      ...(event.detail ? { detail: event.detail } : {}),
    };

    await prisma.custodyLayer.update({
      where: { dnaRecordId },
      data: { custodyChain: [...chain, entry] as never },
    });
  } catch (err) {
    logger.warn('[CustodyChain] append failed (non-fatal)', {
      dnaRecordId, event: event.event, error: String(err),
    });
  }
}
