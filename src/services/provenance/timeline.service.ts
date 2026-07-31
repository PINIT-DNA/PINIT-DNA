/**
 * Timeline read API for investigation reports and tracking dashboard.
 * DNA matching is never modified — this only loads custody events.
 */
import {
  forensicProvenanceService,
  type ProvenanceSummary,
  type ProvenanceTimelineEvent,
} from '../forensics/forensic-provenance.service';

export async function loadEvidenceTimeline(params: {
  dnaRecordId: string;
  vaultId?: string | null;
}): Promise<{ events: ProvenanceTimelineEvent[]; summary: ProvenanceSummary }> {
  const events = await forensicProvenanceService.getTimeline(params);
  const summary = forensicProvenanceService.buildSummary(events);
  return { events, summary };
}

export async function loadDownloadHistory(params: {
  dnaRecordId: string;
  vaultId?: string | null;
}): Promise<ProvenanceTimelineEvent[]> {
  const { events } = await loadEvidenceTimeline(params);
  return events.filter((e) =>
    e.eventType === 'DOWNLOADED'
    || e.eventType === 'PROTECTED_EXPORT'
    || e.eventType === 'TEP_CREATED',
  );
}
