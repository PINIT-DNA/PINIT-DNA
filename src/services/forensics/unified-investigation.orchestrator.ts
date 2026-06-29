/**
 * Unified Forensic Investigation Center — orchestrates existing services only.
 */
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { leakedFileVerifyService } from './leaked-file-verify.service';
import { vaultAutoMatchService, type VaultMatchResult } from './vault-auto-match.service';
import { VaultService } from '../vault/vault.service';
import { DnaComparisonService } from '../verification/dna-comparison.service';
import { certificateService } from '../certificates/certificate.service';
import { shareLinkService } from '../share/share-link.service';
import { monitoringService } from '../crawler/monitoring.service';
import { tamperClassifierService } from './tamper-classifier.service';
import { isPhase2Active } from '../../config/dna-phase2';
import { generateLightweightDna } from './lightweight-dna.service';
import { resolveWatermarkProof } from './watermark-status.service';
import { phase3WatermarkRecovery } from '../watermark/phase3-watermark-recovery.service';
import { isPhase3WatermarkRecoveryActive } from '../../config/dna-phase3';
import type {
  UnifiedInvestigationReport,
  InvestigationPipelineStep,
  TamperAnalysisSection,
  LeakedFileAccessEntry,
} from '../../types/unified-investigation.types';
const vaultService = new VaultService();
const comparisonService = new DnaComparisonService();

function step(
  id: string,
  label: string,
  status: InvestigationPipelineStep['status'],
  detail?: string,
): InvestigationPipelineStep {
  return { id, label, status, detail };
}

function layerStatus(pct: number): 'verified' | 'warning' | 'failed' {
  if (pct >= 80) return 'verified';
  if (pct >= 50) return 'warning';
  return 'failed';
}

function riskFromScores(dnaPct: number, tamper: number, found: boolean): UnifiedInvestigationReport['summary']['riskLevel'] {
  if (!found) return 'UNKNOWN';
  if (tamper >= 70) return 'CRITICAL';
  if (dnaPct >= 95 && tamper < 20) return 'LOW';
  if (dnaPct >= 70) return 'MEDIUM';
  return 'HIGH';
}

export class UnifiedInvestigationOrchestrator {
  async investigate(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    ownerUserId: string,
  ): Promise<UnifiedInvestigationReport> {
    const investigationId = uuidv4();
    const pipeline: InvestigationPipelineStep[] = [];
    const sizeBytes = buffer.length;

    // 1. Extract embedded identity (leaked-file verify engine)
    const leakVerify = await leakedFileVerifyService.verify(buffer, mimeType, originalName);
    pipeline.push(step(
      'identity',
      'Extract embedded identity',
      leakVerify.found ? 'complete' : 'warning',
      leakVerify.detectionMethod ?? leakVerify.message,
    ));

    // Phase 3: watermark recovery → vault resolution (falls back to DNA compare)
    let phase3Recovery: Awaited<ReturnType<typeof phase3WatermarkRecovery.recover>> | null = null;
    if (isPhase3WatermarkRecoveryActive()) {
      phase3Recovery = await phase3WatermarkRecovery.recover(buffer, mimeType, ownerUserId);
      pipeline.push(step(
        'watermark_recovery',
        'Watermark recovery',
        phase3Recovery.recovered ? 'complete' : phase3Recovery.fallbackToDna ? 'skipped' : 'warning',
        phase3Recovery.detail,
      ));
    }

    // 2. Lightweight DNA (Phase 2 when enabled)
    if (isPhase2Active()) {
      try {
        const lite = await generateLightweightDna(buffer, mimeType);
        pipeline.push(step('lightweight_dna', 'Generate lightweight DNA', 'complete', `Profile: ${lite.mediaProfile}`));
      } catch {
        pipeline.push(step('lightweight_dna', 'Generate lightweight DNA', 'skipped', 'Phase 2 disabled or failed'));
      }
    } else {
      pipeline.push(step('lightweight_dna', 'Generate lightweight DNA', 'skipped', 'DNA_PHASE2_ENABLED=false'));
    }

    // 3–4. Vault match
    let match: VaultMatchResult | null = leakVerify.identity?.vaultId && leakVerify.identity?.dnaId
      ? {
          tier: 2 as const,
          method: leakVerify.detectionMethod ?? 'Leaked-file identity',
          dnaRecordId: leakVerify.identity.dnaId,
          vaultId: leakVerify.identity.vaultId,
          ownerUserId: leakVerify.identity.ownerUserId ?? ownerUserId,
          confidence: leakVerify.valid ? 'HIGH' : 'MEDIUM',
        }
      : null;

    if (!match && phase3Recovery?.recovered && phase3Recovery.vaultId && phase3Recovery.dnaRecordId) {
      match = {
        tier: 2,
        method: `Phase 3 watermark recovery (${phase3Recovery.method})`,
        dnaRecordId: phase3Recovery.dnaRecordId,
        vaultId: phase3Recovery.vaultId,
        ownerUserId: phase3Recovery.ownerUserId ?? ownerUserId,
        confidence: phase3Recovery.tokenValid ? 'HIGH' : 'MEDIUM',
      };
    }

    if (!match) {
      match = await vaultAutoMatchService.findMatch(buffer, mimeType, originalName, sizeBytes, ownerUserId);
    }

    pipeline.push(step(
      'vault_search',
      'Search vault DNA records',
      match ? 'complete' : 'failed',
      match ? `Match tier ${match.tier}: ${match.method}` : 'No vault match in your account',
    ));

    if (!match) {
      return this.noMatchReport(investigationId, pipeline, leakVerify);
    }

    pipeline.push(step('vault_locate', 'Locate original vault file', 'complete', match.vaultId));

    // 5. Certificate
    const cert = await prisma.certificate.findFirst({
      where: { vaultId: match.vaultId, dnaRecordId: match.dnaRecordId, status: 'ACTIVE' },
      orderBy: { issuedAt: 'desc' },
    });
    let certStatus = 'NOT_ISSUED';
    if (cert) {
      const v = await certificateService.verify(cert.certificateId);
      certStatus = v.valid ? 'VALID' : v.status;
      pipeline.push(step('certificate', 'Verify certificate', v.valid ? 'complete' : 'warning', v.detail));
    } else {
      pipeline.push(step('certificate', 'Verify certificate', 'warning', 'No active certificate'));
    }

    // 6. Full DNA comparison (same inputs as Auto Compare — do not alter DnaComparisonService)
    let comparison = null;
    let isIdentical = false;
    try {
      const original = await vaultService.retrieve(match.vaultId, ownerUserId);
      isIdentical = original.originalBuffer.equals(buffer);
      try {
        comparison = await comparisonService.compare(
          {
            filePath: '',
            originalName: original.originalFileName,
            declaredMimeType: original.originalMimeType,
            sizeBytes: original.originalSizeBytes,
            buffer: original.originalBuffer,
          },
          {
            filePath: '',
            originalName,
            declaredMimeType: mimeType,
            sizeBytes,
            buffer,
          },
        );
        pipeline.push(step(
          'dna_compare',
          '15-layer DNA comparison',
          'complete',
          `${comparison.overallConfidenceScore}% — ${comparison.classification}`,
        ));
      } catch (cmpErr) {
        logger.error('Unified investigation DNA compare failed', { error: String(cmpErr) });
        pipeline.push(step(
          'dna_compare',
          '15-layer DNA comparison',
          isIdentical ? 'complete' : 'warning',
          isIdentical
            ? 'Byte-identical to vault original'
            : match.visualSimilarity
              ? `Visual match ${Math.round((match.visualSimilarity ?? 0) * 100)}% — layer compare unavailable`
              : String(cmpErr),
        ));
      }
    } catch (e) {
      pipeline.push(step('dna_compare', '15-layer DNA comparison', 'failed', String(e)));
    }

    // 7. Tamper analysis
    const tamperAnalysis = this.buildTamperAnalysis(comparison, leakVerify);
    pipeline.push(step('tamper', 'Tamper analysis', 'complete', tamperAnalysis.primaryVector));

    const accessIntelligence = await this.loadAccessIntelligence(
      match.dnaRecordId,
      ownerUserId,
      leakVerify.accessHistory ?? [],
    );

    // 8–11. Recipient + sharing + access
    const hasShare = !!(leakVerify.shareLink || leakVerify.recipient)
      || accessIntelligence.some((a) => a.action && !a.action.startsWith('TEP_'));
    pipeline.push(step(
      'recipient',
      'Recipient attribution',
      hasShare ? 'complete' : 'skipped',
      hasShare ? 'Share lineage detected' : 'Original owner only',
    ));

    pipeline.push(step(
      'access_history',
      'Access history',
      'complete',
      `${accessIntelligence.length} events`,
    ));

    // 12. Timeline
    let timelineEvents: Array<{ stage: string; timestamp?: string; detail?: string }> = [];
    try {
      const shareTimeline = await shareLinkService.getTimelineEvents(match.dnaRecordId, ownerUserId);
      timelineEvents = this.buildTimeline(match.dnaRecordId, shareTimeline, leakVerify);
      pipeline.push(step('timeline', 'Retrieve timeline', 'complete', `${timelineEvents.length} events`));
    } catch {
      pipeline.push(step('timeline', 'Retrieve timeline', 'warning', 'Timeline partial'));
      timelineEvents = this.buildTimeline(match.dnaRecordId, [], leakVerify);
    }

    // 13. Crawler / monitoring
    const leakIntel = await this.buildLeakIntelligence(match.dnaRecordId, ownerUserId);
    pipeline.push(step(
      'crawler',
      'Crawler detections',
      leakIntel.hasPublicLeak ? 'warning' : 'complete',
      leakIntel.message,
    ));

    // 14. Report
    pipeline.push(step('report', 'Generate investigation report', 'complete'));

    const owner = await prisma.user.findUnique({
      where: { id: match.ownerUserId },
      select: { fullName: true, shortId: true, email: true },
    });

    const dnaRec = await prisma.dnaRecord.findUnique({
      where: { id: match.dnaRecordId },
      select: { createdAt: true, imageFilename: true },
    });

    const dnaPct = comparison?.overallConfidenceScore
      ?? (isIdentical ? 100 : undefined)
      ?? (match.visualSimilarity ? Math.round(match.visualSimilarity * 100) : undefined)
      ?? (Number.parseInt(match.confidence, 10) || undefined)
      ?? (leakVerify.confidence ?? 0);

    const identityFromVault = owner?.shortId ?? leakVerify.identity?.ownerShortId;
    const identityStatus = leakVerify.valid
      ? 'VERIFIED'
      : leakVerify.found
        ? 'PARTIAL'
        : identityFromVault
          ? identityFromVault
          : 'NOT_FOUND';

    const ownershipConf = Math.min(100, Math.round(
      dnaPct * 0.6
      + (leakVerify.valid ? 25 : identityFromVault ? 20 : 5)
      + (certStatus === 'VALID' ? 15 : 0)
      + (match.tier <= 2 ? 10 : 0),
    ));

    const layerAnalysis = (comparison?.layerComparisons ?? []).map((l) => ({
      layer: l.layer,
      name: l.name,
      matchPercent: l.similarityPercent,
      status: layerStatus(l.similarityPercent),
      explanation: l.changeDescription,
    }));

    const summary = {
      ownershipConfidence: ownershipConf,
      dnaMatchPercent: dnaPct,
      certificateStatus: certStatus,
      identityStatus,
      tamperSeverity: tamperAnalysis.primaryVector,
      riskLevel: riskFromScores(dnaPct, tamperAnalysis.overallTamperScore, true),
    };

    logger.info('Unified investigation complete', { investigationId, dnaRecordId: match.dnaRecordId });

    return {
      success: true,
      investigationId,
      investigatedAt: new Date().toISOString(),
      pipeline,
      summary,
      owner: {
        ownerName: owner?.fullName ?? leakVerify.identity?.ownerName,
        ownerPinitId: owner?.shortId ?? leakVerify.identity?.ownerShortId,
        vaultId: match.vaultId,
        dnaRecordId: match.dnaRecordId,
        certificateId: cert?.certificateId ?? null,
        originalFilename: dnaRec?.imageFilename ?? leakVerify.identity?.originalFilename,
        createdAt: dnaRec?.createdAt?.toISOString(),
      },
      recipientAttribution: this.buildRecipientSection(leakVerify, accessIntelligence),
      dnaComparison: comparison,
      layerAnalysis,
      tamperAnalysis,
      timeline: timelineEvents,
      accessIntelligence,
      leakIntelligence: leakIntel,
      identityProof: {
        vaultId: match.vaultId,
        dnaRecordId: match.dnaRecordId,
        certificateId: cert?.certificateId,
        ownerPinitId: owner?.shortId ?? leakVerify.identity?.ownerShortId,
        digitalSignatureValid: !!leakVerify.valid,
        watermark: resolveWatermarkProof(leakVerify, {
          vaultId: match.vaultId,
          ownerPinitId: owner?.shortId ?? undefined,
        }, phase3Recovery ?? undefined),
        identityVerification: leakVerify.valid
          ? 'PASSED'
          : identityFromVault
            ? `VAULT_OWNER:${identityFromVault}`
            : leakVerify.found
              ? 'DAMAGED'
              : 'NOT_FOUND',
      },
      leakVerify: {
        found: leakVerify.found,
        valid: leakVerify.valid,
        tampered: leakVerify.tampered,
        detectionMethod: leakVerify.detectionMethod,
        leakVector: leakVerify.leakVector,
        confidence: leakVerify.confidence,
        message: leakVerify.message,
        accessHistory: accessIntelligence,
      },
      matchTier: match.tier,
      matchMethod: match.method,
    };
  }

  private noMatchReport(
    investigationId: string,
    pipeline: InvestigationPipelineStep[],
    leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>>,
  ): UnifiedInvestigationReport {
    pipeline.push(step('report', 'Generate investigation report', 'complete', 'No vault match'));
    return {
      success: false,
      investigationId,
      investigatedAt: new Date().toISOString(),
      pipeline,
      summary: {
        ownershipConfidence: leakVerify.found ? Math.round((leakVerify.confidence ?? 0) * 0.5) : 0,
        dnaMatchPercent: 0,
        certificateStatus: 'UNKNOWN',
        identityStatus: leakVerify.found ? 'DETECTED_NO_VAULT' : 'NOT_FOUND',
        tamperSeverity: 'UNKNOWN',
        riskLevel: 'UNKNOWN',
      },
      owner: {
        ownerName: leakVerify.identity?.ownerName,
        ownerPinitId: leakVerify.identity?.ownerShortId,
        vaultId: leakVerify.identity?.vaultId,
        dnaRecordId: leakVerify.identity?.dnaId,
      },
      recipientAttribution: this.buildRecipientSection(leakVerify),
      layerAnalysis: [],
      tamperAnalysis: this.buildTamperAnalysis(null, leakVerify),
      timeline: [],
      accessIntelligence: leakVerify.accessHistory ?? [],
      leakIntelligence: { hasPublicLeak: false, entries: [], message: 'No public leak detected.' },
      identityProof: {
        vaultId: leakVerify.identity?.vaultId,
        dnaRecordId: leakVerify.identity?.dnaId,
        digitalSignatureValid: !!leakVerify.valid,
        watermark: resolveWatermarkProof(leakVerify, {
          vaultId: leakVerify.identity?.vaultId,
          ownerPinitId: leakVerify.identity?.ownerShortId,
        }),
        identityVerification: leakVerify.valid ? 'PASSED' : 'NOT_FOUND',
      },
      leakVerify: {
        found: leakVerify.found,
        message: leakVerify.message,
        accessHistory: leakVerify.accessHistory,
      },
      message: 'Could not locate original vault file in your account. Identity signals may still be present.',
    };
  }

  private buildTamperAnalysis(
    comparison: Awaited<ReturnType<DnaComparisonService['compare']>> | null,
    leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>>,
  ): TamperAnalysisSection {
    const vectors = [
      { label: 'Compression', detected: false },
      { label: 'Crop', detected: false },
      { label: 'Resize', detected: false },
      { label: 'Screenshot', detected: leakVerify.leakVector === 'SCREENSHOT' },
      { label: 'Screen Recording', detected: leakVerify.leakVector === 'RECORDING' },
      { label: 'Metadata Removed', detected: false },
      { label: 'OCR Changes', detected: false },
      { label: 'AI Editing', detected: false },
      { label: 'AI Enhancement', detected: false },
      { label: 'Watermark Damage', detected: !!leakVerify.tampered && !!leakVerify.watermark },
      { label: 'Video Re-encoding', detected: false },
      { label: 'Audio Re-encoding', detected: false },
    ];

    if (comparison?.layerComparisons) {
      const l1 = comparison.layerComparisons.find((l) => l.layer === 1);
      const l3 = comparison.layerComparisons.find((l) => l.layer === 3);
      const l5 = comparison.layerComparisons.find((l) => l.layer === 5);
      if (l1?.changed && l3 && l3.similarityPercent >= 90) vectors[0]!.detected = true;
      if (l3 && l3.similarityPercent >= 60 && l3.similarityPercent < 85) vectors[1]!.detected = true;
      if (l5?.changed && !l1?.changed) vectors[5]!.detected = true;
    }

    let primaryVector = 'NONE';
    let overallTamperScore = 10;
    let description = 'No significant tampering detected';

    if (comparison?.layerComparisons) {
      const inputs = comparison.layerComparisons.slice(0, 6).map((l) => ({
        layer: l.name,
        score: l.similarityScore,
        weight: 0.15,
        passed: l.matched,
      }));
      const t = tamperClassifierService.classify(inputs);
      primaryVector = t.primaryVector;
      overallTamperScore = t.tamperConfidence;
      description = t.description;
    } else if (leakVerify.tampered) {
      primaryVector = 'COPY_PASTE';
      overallTamperScore = 55;
      description = 'File modified from protected original';
    }

    return { primaryVector, overallTamperScore, vectors, description };
  }

  private buildRecipientSection(
    leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>>,
    accessHistory: LeakedFileAccessEntry[] = [],
  ) {
    const history = accessHistory.length ? accessHistory : (leakVerify.accessHistory ?? []);
    const fromShare = !!(leakVerify.shareLink || leakVerify.recipient)
      || history.some((a) => a.action && !a.action.startsWith('TEP_') && !a.action.startsWith('PROTECTED_'));
    if (!fromShare) {
      return { fromShare: false, message: 'Original Owner Only — no share recipient attribution.' };
    }
    const dl = history.find((a) => a.action?.toLowerCase().includes('download'));
    const view = history.find((a) => a.action?.toLowerCase().includes('view'));
    return {
      fromShare: true,
      recipientName: leakVerify.recipient?.label ?? leakVerify.shareLink?.recipientLabel,
      recipientPinitId: leakVerify.recipient?.recipientCode,
      shareId: leakVerify.shareLink?.token,
      viewTime: view?.timestamp,
      downloadTime: dl?.timestamp,
      screenshotDetected: leakVerify.leakVector === 'SCREENSHOT',
      screenRecordingDetected: leakVerify.leakVector === 'RECORDING',
      lastDevice: history[0]?.device,
      message: 'File traced to a shared copy recipient.',
    };
  }

  private buildTimeline(
    _dnaRecordId: string,
    shareEvents: unknown[],
    leakVerify: Awaited<ReturnType<typeof leakedFileVerifyService.verify>>,
  ): Array<{ stage: string; timestamp?: string; detail?: string }> {
    const out: Array<{ stage: string; timestamp?: string; detail?: string }> = [];
    if (leakVerify.identity?.dnaCreatedAt) {
      out.push({ stage: 'DNA Generated', timestamp: leakVerify.identity.dnaCreatedAt });
    }
    out.push({ stage: 'Stored in Vault', detail: leakVerify.identity?.vaultId });
    for (const ev of shareEvents as Array<{ type?: string; timestamp?: string; title?: string }>) {
      out.push({ stage: ev.title ?? ev.type ?? 'Share Event', timestamp: ev.timestamp });
    }
    if (leakVerify.leakVector === 'SCREENSHOT') out.push({ stage: 'Screenshot', detail: 'Detected' });
    if (leakVerify.tampered) out.push({ stage: 'Modified', detail: leakVerify.detectionMethod });
    out.push({ stage: 'Verified', timestamp: new Date().toISOString(), detail: 'Unified Investigation' });
    out.push({ stage: 'Crawler Detection', detail: 'Future — monitoring framework ready' });
    return out;
  }

  private async loadAccessIntelligence(
    dnaRecordId: string,
    ownerUserId: string,
    fromLeakVerify: LeakedFileAccessEntry[],
  ): Promise<LeakedFileAccessEntry[]> {
    const merged = new Map<string, LeakedFileAccessEntry>();

    const add = (entry: LeakedFileAccessEntry) => {
      const key = `${entry.timestamp}|${entry.action}|${entry.ipAddress ?? ''}`;
      if (!merged.has(key)) merged.set(key, entry);
    };

    for (const e of fromLeakVerify) add(e);

    const links = await prisma.shareLink.findMany({
      where: { dnaRecordId, ownerUserId },
      include: {
        accessLogs: { orderBy: { createdAt: 'desc' }, take: 40 },
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const link of links) {
      for (const log of link.accessLogs) {
        add({
          timestamp: log.createdAt.toISOString(),
          action: log.action,
          ipAddress: log.ipAddress ?? undefined,
          country: log.country ?? undefined,
          city: log.city ?? undefined,
          region: log.region ?? undefined,
          device: log.device ?? log.userAgent ?? undefined,
          browser: log.browser ?? undefined,
          os: log.os ?? undefined,
          riskLevel: log.riskLevel ?? undefined,
          locationShared: log.locationShared,
        });
      }
    }

    const tepExports = await prisma.trackedExportPackage.findMany({
      where: { dnaRecordId, ownerUserId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    for (const tep of tepExports) {
      add({
        timestamp: tep.createdAt.toISOString(),
        action: 'TEP_EXPORT',
        ipAddress: tep.ipAddress ?? undefined,
        country: tep.geoCountry ?? undefined,
        city: tep.geoCity ?? undefined,
        device: tep.deviceContext ?? undefined,
      });
    }

    return [...merged.values()].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  private async buildLeakIntelligence(dnaRecordId: string, ownerUserId: string) {
    try {
      const monitors = await monitoringService.listMonitors(ownerUserId);
      const related = monitors.filter((m) => m.dnaRecordId === dnaRecordId);
      const entries = related.flatMap((m) =>
        (m.crawlResults ?? []).map((cr) => ({
          platform: 'Web',
          url: cr.url,
          firstSeen: cr.createdAt?.toISOString?.() ?? String(cr.createdAt),
          lastSeen: cr.createdAt?.toISOString?.() ?? String(cr.createdAt),
          status: cr.matchType ?? 'DETECTED',
        })),
      );
      return {
        hasPublicLeak: entries.length > 0,
        entries,
        message: entries.length ? `${entries.length} crawler match(es)` : 'No public leak detected.',
      };
    } catch {
      return { hasPublicLeak: false, entries: [], message: 'No public leak detected.' };
    }
  }
}

export const unifiedInvestigationOrchestrator = new UnifiedInvestigationOrchestrator();
