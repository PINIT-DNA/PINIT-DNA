/**
 * Evidence RAG for Ask PINIT.
 * Retrieval is over owner-scoped Hub records (same payload as Living Asset).
 * The LLM only explains retrieved text — it never queries the database.
 */
import { aiService } from '../ai/ai-embeddings.service';
import { logger } from '../../lib/logger';
import { createLlmProvider } from './ask-pinit-llm';
import { buildIntelligenceReportPayload } from './intelligence-report.builder';

export type EvidenceChunk = { id: string; text: string };

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

export function chunksFromIntelligenceReport(report: Awaited<ReturnType<typeof buildIntelligenceReportPayload>>): EvidenceChunk[] {
  if (!report) return [];
  const { identity, provenance, integrity, distribution, discovery, risk } = report;
  const chunks: EvidenceChunk[] = [
    {
      id: 'identity',
      text: `Asset filename ${identity.filename}. MIME ${identity.mimeType}. DNA record ${identity.dnaRecordId}. Vault ${report.vaultId}. File type ${identity.fileType}.`,
    },
    {
      id: 'capture',
      text: `CAPTURE LOCATION / TIME (file metadata): capturedAt=${provenance.capturedAt ?? 'not recorded'}. capture GPS lat=${provenance.gpsLatitude ?? 'not recorded'} lng=${provenance.gpsLongitude ?? 'not recorded'}. place=${provenance.city ?? 'not recorded'} country=${provenance.country ?? 'not recorded'}. device=${provenance.deviceModel ?? 'not recorded'}. protected/vaultedAt=${provenance.vaultedAt}.`,
    },
    {
      id: 'access-location',
      text: `ACCESS LOCATION (share/view activity, not capture): city=${provenance.city ?? 'not recorded'} country=${provenance.country ?? 'not recorded'} accessGps=${provenance.accessGpsCity ?? 'not recorded'}.`,
    },
    {
      id: 'protection',
      text: `Protection/DNA: status=${integrity.dnaStatus} tamperStatus=${integrity.tamperStatus} sha256=${integrity.sha256Hash ?? 'not recorded'}. lastVerification=${integrity.lastVerification ? `${integrity.lastVerification.passed ? 'passed' : 'failed'} at ${integrity.lastVerification.at}` : 'not recorded'}.`,
    },
    {
      id: 'sharing',
      text: `SHARE LINKS (Living Asset source): totalShareLinks=${distribution.totalShareLinks}. activeLinks=${distribution.activeLinks}. totalViews=${distribution.totalViews}. totalDownloads=${distribution.totalDownloads}. totalAccessEvents=${distribution.totalEvents}. recipients=${distribution.recipients.join(', ') || 'none recorded'}.`,
    },
    {
      id: 'investigation',
      text: `Investigation/monitoring: matches=${discovery.totalMatches} exact=${discovery.exactMatches} evidence=${risk.evidenceCount} suspiciousAccess=${risk.suspiciousEvents}. leakIndicators=${risk.leakIndicators.join('; ') || 'none recorded'}.`,
    },
  ];
  if (distribution.timeline.length) {
    chunks.push({
      id: 'timeline',
      text: `Access timeline: ${distribution.timeline.slice(0, 12).map((t) => `${t.at} ${t.action}${t.country ? ` ${t.country}` : ''}`).join('; ')}`,
    });
  }
  return chunks;
}

export async function retrieveEvidenceChunks(
  question: string,
  chunks: EvidenceChunk[],
  pinIds: string[],
): Promise<EvidenceChunk[]> {
  if (!chunks.length) return [];
  const pinned = chunks.filter((c) => pinIds.includes(c.id));
  const rest = chunks.filter((c) => !pinIds.includes(c.id));

  const qEmbed = await aiService.embed(question.slice(0, 2000));
  if (qEmbed?.embedding?.length && rest.length) {
    const scored = await Promise.all(rest.map(async (c) => {
      const e = await aiService.embed(c.text.slice(0, 2000));
      return { c, s: e?.embedding?.length ? cosine(qEmbed.embedding, e.embedding) : 0 };
    }));
    scored.sort((a, b) => b.s - a.s);
    const picked = scored.filter((x) => x.s >= 0.15).slice(0, 5).map((x) => x.c);
    return [...pinned, ...picked.filter((c) => !pinned.some((p) => p.id === c.id))];
  }

  const q = question.toLowerCase();
  const lexical = rest
    .map((c) => ({
      c,
      s: q.split(/\s+/).filter((w) => w.length > 3 && c.text.toLowerCase().includes(w)).length,
    }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.c);
  return [...pinned, ...lexical.filter((c) => !pinned.some((p) => p.id === c.id))];
}

export async function generateFromEvidence(input: {
  question: string;
  draft: string;
  evidence: EvidenceChunk[];
}): Promise<string> {
  const evidenceText = input.evidence.map((c) => `[${c.id}] ${c.text}`).join('\n');
  const llm = createLlmProvider();
  if (!llm) return input.draft;
  try {
    const polished = await llm.polish({
      question: input.question,
      evidence: evidenceText,
      draft: input.draft,
    });
    return polished || input.draft;
  } catch (err) {
    logger.debug('Ask PINIT LLM skipped', { error: String(err) });
    return input.draft;
  }
}

export { buildIntelligenceReportPayload };
