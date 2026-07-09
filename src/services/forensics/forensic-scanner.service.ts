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
  };
  tamperLocalization?: {
    modifiedPercent?: number;
    visiblePercent?: number;
    insertedRegions?: number;
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
    confidencePercent?: number;
    reason?: string;
    reasons?: string[];
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

    const online = await aiService.isOnline();
    if (!online) {
      return { available: false, overallConfidence: 0, candidates: [] };
    }

    const result = await aiService.forensicScan(buffer, mimeType, referenceBuffer);
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
      tamperLocalization: result.tamperLocalization,
      screenshotDetection: result.screenshotDetection,
      aiManipulation: result.aiManipulation,
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
