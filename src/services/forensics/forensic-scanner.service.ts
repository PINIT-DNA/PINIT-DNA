/**
 * Enterprise Forensic Scanner — Node bridge to Python multi-stage CV pipeline.
 * Gracefully degrades when Python AI is offline.
 */
import { logger } from '../../lib/logger';
import { aiService } from '../ai/ai-embeddings.service';
import type { MatchReason } from '../../types/unified-investigation.types';

export interface ForensicScanCandidate {
  vaultId: string;
  dnaRecordId?: string;
  filename?: string;
  tileMatches: number;
  bestSimilarity: number;
  confidence: number;
  clipPercent?: number;
  visiblePercent?: number;
  cropPercent?: number;
  missingPercent?: number;
}

export interface ForensicScanResult {
  available: boolean;
  overallConfidence: number;
  candidates: ForensicScanCandidate[];
  features?: Record<string, unknown>;
  cropDetection?: {
    homographyFound?: boolean;
    sharedRegionPercent?: number;
    visiblePercent?: number;
    cropPercent?: number;
    missingPercent?: number;
    matches?: number;
    probeCoveragePercent?: number;
    vaultCoveragePercent?: number;
    probeRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
    vaultRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  };
  blockComposition?: {
    protectedFromAssetPercent: number;
    aiGeneratedPercent: number;
    otherPercent: number;
    overlayPngBase64?: string;
    blockSize?: number;
    matchedBlocks?: number;
    aiBlocks?: number;
    otherBlocks?: number;
    probeRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
    grid?: { rows: number; cols: number; labels: string };
  };
  pixelSource?: Record<string, unknown>;
  tamperLocalization?: {
    modifiedPercent?: number;
    visiblePercent?: number;
    insertedRegions?: number;
    regions?: Array<{ x: number; y: number; width: number; height: number; type: 'added' | 'removed' | 'modified' }>;
    overlayPngBase64?: string;
    description?: string;
  };
  screenshotDetection?: {
    isScreenshot?: boolean;
    confidencePercent?: number;
    platform?: string;
    evidence?: string;
  };
  aiManipulation?: {
    aiEdited?: boolean;
    aiGenerated?: boolean;
    aiGeneratedConfidence?: number;
    generatedConfidencePercent?: number;
    confidencePercent?: number;
    reason?: string;
    reasons?: string[];
    clip?: Record<string, unknown>;
    ensembleVerdict?: string;
    ensembleAuthenticityScore?: number;
    ensembleTamperScore?: number;
  };
  authenticityEnsemble?: {
    version?: string;
    verdict?: string;
    aiProbability?: number;
    tamperScore?: number;
    authenticityScore?: number;
    confidence?: number;
    confidenceLevel?: string;
    aiGenerated?: boolean;
    generatedConfidencePercent?: number;
    engines?: Array<{
      id: string;
      name: string;
      status: string;
      score?: number;
      summary?: string;
      findings?: string[];
    }>;
    evidence?: Array<{
      id: string;
      engine: string;
      severity: string;
      title: string;
      detail: string;
      scoreImpact?: number;
    }>;
    reasons?: string[];
    heatmapPngBase64?: string | null;
    signals?: Record<string, unknown>;
  };
  matchReasons?: MatchReason[];
  processingMs?: number;
}

export class ForensicScannerService {
  async scanProbe(
    buffer: Buffer,
    mimeType: string,
    referenceBuffer?: Buffer,
  ): Promise<ForensicScanResult> {
    if (!mimeType.startsWith('image/')) {
      return { available: false, overallConfidence: 0, candidates: [] };
    }

    // Attempt scan even if health cache says offline — ensemble may still respond
    let result = await aiService.forensicScan(buffer, mimeType, referenceBuffer);
    if (!result) {
      const online = await aiService.isOnline();
      if (online) {
        result = await aiService.forensicScan(buffer, mimeType, referenceBuffer);
      }
    }
    if (!result) {
      return { available: false, overallConfidence: 0, candidates: [] };
    }

    const candidates = (result.candidates ?? []).map((c) => ({
      vaultId: c.vaultId,
      dnaRecordId: c.dnaRecordId,
      filename: c.filename,
      tileMatches: c.tileMatches ?? 0,
      bestSimilarity: c.bestSimilarity ?? 0,
      confidence: Math.round((c.confidence ?? 0) * 100),
      clipPercent: c.clipPercent,
      visiblePercent: c.visiblePercent,
      cropPercent: c.cropPercent,
      missingPercent: c.missingPercent,
    }));

    logger.info('[ForensicScanner] Scan complete', {
      candidates: candidates.length,
      topVault: candidates[0]?.vaultId?.slice(0, 8),
      confidence: result.overallConfidence,
      clip: candidates[0]?.clipPercent,
    });

    return {
      available: true,
      overallConfidence: Math.round((result.overallConfidence ?? 0) * 100),
      candidates,
      features: result.features,
      cropDetection: result.cropDetection,
      blockComposition: result.blockComposition as ForensicScanResult['blockComposition'],
      pixelSource: result.pixelSource,
      tamperLocalization: result.tamperLocalization,
      screenshotDetection: result.screenshotDetection,
      aiManipulation: result.aiManipulation,
      authenticityEnsemble: result.authenticityEnsemble,
      matchReasons: result.matchReasons,
      processingMs: result.processingMs,
    };
  }

  async indexVaultTiles(
    buffer: Buffer,
    mimeType: string,
    vaultId: string,
    dnaRecordId: string,
  ): Promise<boolean> {
    if (!mimeType.startsWith('image/')) return false;
    const ok = await aiService.forensicIndexTiles(buffer, mimeType, vaultId, dnaRecordId);
    return !!ok;
  }
}

export const forensicScannerService = new ForensicScannerService();
