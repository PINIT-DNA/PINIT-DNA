/**
 * Match pipeline — incident, evidence, investigation, UEE notification.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../../lib/prisma';
import { logger } from '../../../../lib/logger';
import { unifiedInvestigationOrchestrator } from '../../../forensics/unified-investigation.orchestrator';
import { emitMonitoringMatch } from '../../../platform-events/module-events';
import type { DnaComparisonResult, DownloadedAsset, MatchPipelineResult } from '../types';

export class MatchPipelineService {
  async processMatch(params: {
    monitorRecordId: string;
    dnaRecordId: string;
    ownerUserId: string;
    filename: string;
    comparison: DnaComparisonResult;
    asset: DownloadedAsset;
  }): Promise<MatchPipelineResult> {
    const { monitorRecordId, dnaRecordId, ownerUserId, filename, comparison, asset } = params;

    const incidentCode = `INC-${Date.now().toString(36).toUpperCase()}`;
    const severity = comparison.matchType === 'EXACT_MATCH' ? 'CRITICAL'
      : comparison.matchType === 'HIGH_MATCH' ? 'HIGH' : 'MEDIUM';

    const incident = await prisma.incident.create({
      data: {
        incidentCode,
        dnaRecordId,
        severity,
        status: 'OPEN',
        triggerType: 'CRAWLER_MATCH',
        description: `${filename} potential match on ${asset.platform} (${Math.round(comparison.similarity * 100)}%)`,
        metadata: JSON.stringify({
          platform: asset.platform,
          sourceUrl: asset.sourceUrl,
          assetUrl: asset.assetUrl,
          matchType: comparison.matchType,
          similarity: comparison.similarity,
          method: comparison.method,
        }),
      },
    });

    const evidenceCode = `EVD-${Date.now().toString(36).toUpperCase()}`;
    const evidence = await prisma.evidenceRecord.create({
      data: {
        evidenceCode,
        incidentId: incident.id,
        dnaRecordId,
        ownerUserId,
        evidenceType: 'CRAWLER_MATCH',
        description: `Public copy detected on ${asset.platform}: ${asset.assetUrl ?? asset.sourceUrl}`,
        hash: comparison.details?.probeHash as string | undefined ?? null,
        metadata: JSON.stringify({
          platform: asset.platform,
          sourceUrl: asset.sourceUrl,
          assetUrl: asset.assetUrl,
          mimeType: asset.mimeType,
          similarity: comparison.similarity,
          confidence: comparison.confidence,
        }),
      },
    });

    let investigationId: string | undefined;
    if (comparison.matchType === 'EXACT_MATCH' || comparison.matchType === 'HIGH_MATCH') {
      try {
        const report = await unifiedInvestigationOrchestrator.investigate(
          asset.buffer,
          asset.mimeType,
          asset.filename,
          ownerUserId,
        );
        investigationId = report.investigationId;
      } catch (err) {
        logger.warn('[MatchPipeline] Investigation failed (non-fatal)', { error: String(err) });
      }
    }

    const riskScore = Math.round(comparison.similarity * 100);
    const match = await prisma.crawlerMatch.create({
      data: {
        monitorRecordId,
        dnaRecordId,
        ownerUserId,
        platform: asset.platform,
        sourceUrl: asset.sourceUrl,
        assetUrl: asset.assetUrl,
        assetType: asset.assetType,
        similarity: comparison.similarity,
        matchType: comparison.matchType,
        riskScore,
        confidence: comparison.confidence,
        incidentId: incident.id,
        investigationId: investigationId ?? null,
        evidenceId: evidence.id,
        metadata: {
          method: comparison.method,
          mimeType: asset.mimeType,
        } as Prisma.InputJsonValue,
      },
    });

    await prisma.crawlResult.create({
      data: {
        monitorRecordId,
        url: asset.assetUrl ?? asset.sourceUrl,
        pageTitle: asset.filename,
        foundText: asset.sourceUrl,
        textLength: asset.buffer.length,
        similarity: comparison.similarity,
        matchType: comparison.matchType,
        alertStatus: 'PENDING',
        evidenceGenerated: true,
      },
    });

    emitMonitoringMatch({
      ownerUserId,
      monitorRecordId,
      dnaRecordId,
      filename,
      url: asset.assetUrl ?? asset.sourceUrl,
      matchType: comparison.matchType,
      similarity: Math.round(comparison.similarity * 100),
    });

    logger.info('[MatchPipeline] Match processed', {
      matchId: match.id,
      incidentId: incident.id,
      platform: asset.platform,
      similarity: comparison.similarity,
    });

    return {
      matchId: match.id,
      incidentId: incident.id,
      evidenceId: evidence.id,
      investigationId,
      notified: true,
    };
  }
}

export const matchPipelineService = new MatchPipelineService();
