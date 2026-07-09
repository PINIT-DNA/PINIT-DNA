/**
 * Builds explainable match reasons from forensic scan + DNA + watermark signals.
 */
import type { ForensicScanResult } from './forensic-scanner.service';
import type { DnaComparisonResult } from '../../types/comparison.types';
import type { ForensicEvidenceSection, MatchReason } from '../../types/unified-investigation.types';

export function buildExplainableMatchReasons(input: {
  forensicScan?: ForensicScanResult | null;
  dnaComparison?: DnaComparisonResult | null;
  watermarkDetected?: boolean;
  watermarkConfidence?: number;
  ocrMatchPercent?: number;
}): MatchReason[] {
  const reasons: MatchReason[] = [];

  if (input.forensicScan?.available) {
    for (const c of input.forensicScan.candidates.slice(0, 1)) {
      if (c.tileMatches > 0) {
        reasons.push({
          signal: 'tile_pyramid',
          label: 'Tile Pyramid FAISS',
          percent: Math.min(99, c.confidence),
          matched: c.confidence >= 50,
        });
      }
      if (c.bestSimilarity > 0) {
        reasons.push({
          signal: 'orb',
          label: 'ORB Features',
          percent: Math.round(c.bestSimilarity * 100),
          matched: c.bestSimilarity >= 0.5,
        });
      }
    }
    if (input.forensicScan.cropDetection?.sharedRegionPercent) {
      reasons.push({
        signal: 'homography',
        label: 'Shared Region (RANSAC)',
        percent: input.forensicScan.cropDetection.sharedRegionPercent,
        matched: input.forensicScan.cropDetection.sharedRegionPercent >= 40,
      });
    }
  }

  if (input.dnaComparison?.overallConfidenceScore != null) {
    reasons.push({
      signal: 'dna',
      label: '15-Layer DNA',
      percent: Math.round(input.dnaComparison.overallConfidenceScore),
      matched: input.dnaComparison.overallConfidenceScore >= 50,
    });
  }

  if (input.watermarkDetected) {
    reasons.push({
      signal: 'watermark',
      label: 'Hidden Watermark',
      percent: input.watermarkConfidence ?? 100,
      matched: true,
    });
  }

  if (input.ocrMatchPercent != null && input.ocrMatchPercent > 0) {
    reasons.push({
      signal: 'ocr',
      label: 'OCR Text',
      percent: input.ocrMatchPercent,
      matched: input.ocrMatchPercent >= 70,
    });
  }

  return reasons.sort((a, b) => b.percent - a.percent);
}

export function buildForensicEvidenceSection(input: {
  forensicScan?: ForensicScanResult | null;
  matchReasons?: MatchReason[];
  ownerName?: string | null;
  vaultId?: string;
  dnaRecordId?: string;
  certificateId?: string | null;
  uploadDate?: string;
  watermarkDetected?: boolean;
  distributionPlatforms?: string[];
}): ForensicEvidenceSection {
  const scan = input.forensicScan;
  const screenshot = scan?.screenshotDetection;
  const aiEdit = scan?.aiManipulation;

  return {
    recoveredWatermark: input.watermarkDetected,
    recoveredOwner: input.ownerName ?? null,
    vaultId: input.vaultId,
    dnaRecordId: input.dnaRecordId,
    certificateId: input.certificateId ?? null,
    uploadDate: input.uploadDate,
    distributionPlatforms: input.distributionPlatforms ?? [],
    screenshotDetected: screenshot?.isScreenshot,
    screenshotPlatform: screenshot?.platform,
    screenshotConfidence: screenshot?.confidencePercent,
    aiEdited: aiEdit?.aiEdited,
    aiEditConfidence: aiEdit?.confidencePercent,
    aiEditReason: aiEdit?.reason,
    matchReasons: input.matchReasons,
    overallConfidence: scan?.overallConfidence,
  };
}
