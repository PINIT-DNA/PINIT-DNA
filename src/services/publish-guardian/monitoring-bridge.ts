/**
 * Bridge Monitoring matches → Publish Guardian ProtectedPost discoveries.
 * Additive — failures never break the crawler.
 */

import { prisma } from '../../lib/prisma';
import { publishGuardianService } from '../publish-guardian/publish-guardian.service';

export async function notifyPublishGuardianOfMatch(params: {
  monitorRecordId: string;
  discoveryUrl: string;
  pageTitle?: string | null;
  matchType: string;
  similarity: number;
  crawlResultId?: string | null;
}): Promise<void> {
  try {
    if (!params.matchType || /NO_MATCH/i.test(params.matchType)) return;

    const monitor = await prisma.monitorRecord.findUnique({
      where: { id: params.monitorRecordId },
      select: { dnaRecordId: true, ownerUserId: true },
    });
    if (!monitor?.dnaRecordId) return;

    await publishGuardianService.markScan(monitor.dnaRecordId);
    await publishGuardianService.recordDiscoveryFromMonitor({
      dnaRecordId: monitor.dnaRecordId,
      ownerUserId: monitor.ownerUserId,
      discoveryUrl: params.discoveryUrl,
      pageTitle: params.pageTitle ?? null,
      matchType: params.matchType,
      similarity: params.similarity,
      crawlResultId: params.crawlResultId ?? null,
    });
  } catch {
    /* never break monitoring */
  }
}
