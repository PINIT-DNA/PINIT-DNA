/**
 * Chain-of-custody projection for reports (read-only).
 */
import { loadEvidenceTimeline } from './timeline.service';
import type { ProvenanceTimelineEvent } from '../forensics/forensic-provenance.service';

export interface ChainOfCustodyLink {
  step: string;
  eventType: string;
  timestamp: string;
  summary: string;
  locationLabel?: string;
  actorLabel?: string;
  tepCode?: string;
}

const STEP_ORDER = [
  'DNA_GENERATED',
  'ENCRYPTED',
  'VAULT_STORED',
  'CERTIFICATE_ISSUED',
  'PROTECTED_EXPORT',
  'TEP_CREATED',
  'DOWNLOADED',
  'SHARED',
  'OPENED',
  'RECOVERED',
  'INVESTIGATED',
  'TAMPERED',
  'REVOKED',
] as const;

function stepLabel(eventType: string): string {
  return eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function buildChainOfCustody(params: {
  dnaRecordId: string;
  vaultId?: string | null;
}): Promise<ChainOfCustodyLink[]> {
  const { events } = await loadEvidenceTimeline(params);
  const byType = new Map<string, ProvenanceTimelineEvent[]>();
  for (const ev of events) {
    const list = byType.get(ev.eventType) ?? [];
    list.push(ev);
    byType.set(ev.eventType, list);
  }

  const links: ChainOfCustodyLink[] = [];
  for (const type of STEP_ORDER) {
    const list = byType.get(type);
    if (!list?.length) continue;
    for (const ev of list) {
      links.push({
        step: stepLabel(ev.eventType),
        eventType: ev.eventType,
        timestamp: ev.timestamp,
        summary: ev.summary,
        locationLabel: ev.locationLabel,
        actorLabel: ev.actorLabel,
        tepCode: ev.tepCode,
      });
    }
  }

  // Any other event types
  for (const ev of events) {
    if ((STEP_ORDER as readonly string[]).includes(ev.eventType)) continue;
    links.push({
      step: stepLabel(ev.eventType),
      eventType: ev.eventType,
      timestamp: ev.timestamp,
      summary: ev.summary,
      locationLabel: ev.locationLabel,
      actorLabel: ev.actorLabel,
      tepCode: ev.tepCode,
    });
  }

  return links.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}
